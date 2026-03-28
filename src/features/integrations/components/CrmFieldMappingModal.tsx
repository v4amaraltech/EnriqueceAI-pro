'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';

import { ArrowRight, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import type { CrmFieldOption, CrmProvider, FieldMapping } from '../types/crm';
import { DEFAULT_FIELD_MAPPINGS } from '../types/crm';
import { fetchAppFieldsWithCustom, fetchCrmFields, updateCrmFieldMapping } from '../actions/manage-crm';
import { APP_LEAD_FIELDS, CRM_TARGET_FIELDS, PROVIDER_NAMES } from '../constants/crm-fields';

interface MappingRow {
  tempId: string;
  appField: string;
  crmField: string;
}

function generateTempId() {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildInitialRows(
  provider: CrmProvider,
  currentMapping: FieldMapping | null,
): MappingRow[] {
  const mapping = currentMapping?.leads ?? DEFAULT_FIELD_MAPPINGS[provider].leads;
  return Object.entries(mapping).map(([appField, crmField]) => ({
    tempId: generateTempId(),
    appField,
    crmField,
  }));
}

interface CrmFieldMappingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: CrmProvider;
  currentMapping: FieldMapping | null;
  onSaved?: () => void;
}

export function CrmFieldMappingModal({
  open,
  onOpenChange,
  provider,
  currentMapping,
  onSaved,
}: CrmFieldMappingModalProps) {
  const [rows, setRows] = useState<MappingRow[]>(() =>
    buildInitialRows(provider, currentMapping),
  );
  const [isPending, startTransition] = useTransition();
  const [crmFields, setCrmFields] = useState<CrmFieldOption[]>([]);
  const [appFields, setAppFields] = useState<Array<{ value: string; label: string; isCustom?: boolean }>>([...APP_LEAD_FIELDS]);
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [fieldsLoaded, setFieldsLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      fetchCrmFields(provider),
      fetchAppFieldsWithCustom(),
    ]).then(([crmResult, appResult]) => {
      if (crmResult.success && crmResult.data.length > 0) {
        setCrmFields(crmResult.data);
      } else {
        setCrmFields(CRM_TARGET_FIELDS[provider]);
        if (!crmResult.success) {
          console.warn('[CrmFieldMapping] Failed to fetch CRM fields:', crmResult.error);
        }
      }
      if (appResult.success) {
        setAppFields(appResult.data);
      }
      setFieldsLoaded(true);
    }).catch((err) => {
      console.warn('[CrmFieldMapping] Error loading fields:', err);
      setCrmFields(CRM_TARGET_FIELDS[provider]);
      setFieldsLoaded(true);
    }).finally(() => {
      setIsLoadingFields(false);
    });
  }, [open, provider]);

  // Reset rows when modal opens with new data
  function handleOpenChange(isOpen: boolean) {
    if (isOpen) {
      setRows(buildInitialRows(provider, currentMapping));
      setIsLoadingFields(true);
      setFieldsLoaded(false);
    }
    onOpenChange(isOpen);
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { tempId: generateTempId(), appField: '', crmField: '' },
    ]);
  }

  function removeRow(tempId: string) {
    setRows((prev) => prev.filter((r) => r.tempId !== tempId));
  }

  function updateRow(tempId: string, updates: Partial<MappingRow>) {
    setRows((prev) =>
      prev.map((r) => (r.tempId === tempId ? { ...r, ...updates } : r)),
    );
  }

  function handleSave() {
    // Validate: no empty fields
    for (const row of rows) {
      if (!row.appField || !row.crmField) {
        toast.error('Preencha todos os campos antes de salvar');
        return;
      }
    }

    // Validate: no duplicate app fields
    const usedFields = rows.map((r) => r.appField);
    const duplicates = usedFields.filter((f, i) => usedFields.indexOf(f) !== i);
    if (duplicates.length > 0) {
      const label = appFields.find((f) => f.value === duplicates[0])?.label ?? duplicates[0];
      toast.error(`Campo "${label}" duplicado. Cada campo Enriquece AI pode ser mapeado apenas uma vez.`);
      return;
    }

    const leads: Record<string, string> = {};
    for (const row of rows) {
      leads[row.appField] = row.crmField;
    }

    startTransition(async () => {
      const result = await updateCrmFieldMapping(provider, { leads });
      if (result.success) {
        toast.success('Mapeamento de campos salvo');
        onSaved?.();
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  // Build target fields: loaded CRM fields (or fallback) + any saved values not in the list
  const targetFields = useMemo(() => {
    const base = crmFields.length > 0 ? crmFields : CRM_TARGET_FIELDS[provider];
    const existingValues = new Set(base.map((f) => f.value));

    // Add saved CRM field values that aren't in the loaded options (e.g. numeric IDs when API fails)
    const missing: CrmFieldOption[] = [];
    const labelCache = currentMapping?.crmFieldCache;
    if (currentMapping?.leads) {
      for (const crmValue of Object.values(currentMapping.leads)) {
        if (!existingValues.has(crmValue)) {
          missing.push({
            value: crmValue,
            label: labelCache?.[crmValue] ?? `#${crmValue}`,
            isCustom: true,
          });
          existingValues.add(crmValue);
        }
      }
    }

    return missing.length > 0 ? [...base, ...missing] : base;
  }, [crmFields, provider, currentMapping]);

  // Get already-used app fields to disable in other selects
  const usedAppFields = new Set(rows.map((r) => r.appField).filter(Boolean));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mapeamento de Campos</DialogTitle>
          <DialogDescription>
            Configure quais campos do Enriquece AI correspondem aos campos do {PROVIDER_NAMES[provider]}.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto">
          {isLoadingFields || !fieldsLoaded ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
              <span className="ml-2 text-sm text-[var(--muted-foreground)]">Carregando campos...</span>
            </div>
          ) : rows.length > 0 ? (
            <div className="rounded-lg border border-[var(--border)] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-[var(--muted)]/50">
                    <th className="p-3 text-left text-sm font-medium">Campo Enriquece AI</th>
                    <th className="p-3 text-center text-sm font-medium w-8" />
                    <th className="p-3 text-left text-sm font-medium">Campo CRM</th>
                    <th className="p-3 text-right text-sm font-medium w-12" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.tempId} className="border-b last:border-0">
                      <td className="p-2">
                        <Select
                          value={row.appField}
                          onValueChange={(v) => updateRow(row.tempId, { appField: v })}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel>Padrão</SelectLabel>
                              {appFields.filter((f) => !f.isCustom).map((f) => (
                                <SelectItem
                                  key={f.value}
                                  value={f.value}
                                  disabled={usedAppFields.has(f.value) && row.appField !== f.value}
                                >
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                            {appFields.some((f) => f.isCustom) && (
                              <SelectGroup>
                                <SelectLabel>Personalizado</SelectLabel>
                                {appFields.filter((f) => f.isCustom).map((f) => (
                                  <SelectItem
                                    key={f.value}
                                    value={f.value}
                                    disabled={usedAppFields.has(f.value) && row.appField !== f.value}
                                  >
                                    {f.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2 text-center">
                        <ArrowRight className="mx-auto h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                      </td>
                      <td className="p-2">
                        <Select
                          value={row.crmField}
                          onValueChange={(v) => updateRow(row.tempId, { crmField: v })}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel>Padrão</SelectLabel>
                              {targetFields.filter((f) => !('isCustom' in f && f.isCustom)).map((f) => (
                                <SelectItem key={f.value} value={f.value}>
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                            {targetFields.some((f) => 'isCustom' in f && f.isCustom) && (
                              <SelectGroup>
                                <SelectLabel>Personalizado</SelectLabel>
                                {targetFields.filter((f) => 'isCustom' in f && f.isCustom).map((f) => (
                                  <SelectItem key={f.value} value={f.value}>
                                    {f.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => removeRow(row.tempId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)] py-4 text-center">
              Nenhum campo mapeado. Clique em &quot;Adicionar campo&quot; para começar.
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" onClick={addRow} className="w-full sm:w-auto">
            <Plus className="mr-1 h-4 w-4" />
            Adicionar campo
          </Button>
          <Button onClick={handleSave} disabled={isPending} className="w-full sm:w-auto">
            <Save className="mr-2 h-4 w-4" />
            {isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
