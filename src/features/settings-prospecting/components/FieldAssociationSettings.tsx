'use client';

import { useEffect, useState, useTransition } from 'react';

import Link from 'next/link';
import { ArrowRight, Link2Off, Loader2, Lock, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

import type { CrmProvider, CrmConnectionSafe, CrmFieldOption, FieldMapping } from '@/features/integrations/types/crm';
import { DEFAULT_FIELD_MAPPINGS } from '@/features/integrations/types/crm';
import { fetchAppFieldsWithCustom, fetchCrmFields, updateCrmFieldMapping } from '@/features/integrations/actions/manage-crm';
import {
  APP_LEAD_FIELDS,
  CRM_TARGET_FIELDS,
  PROVIDER_NAMES,
} from '@/features/integrations/constants/crm-fields';

interface MappingRow {
  tempId: string;
  appField: string;
  crmField: string;
  isSystem: boolean;
}

function generateTempId() {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildInitialRows(
  provider: CrmProvider,
  currentMapping: FieldMapping | null,
): MappingRow[] {
  const defaultLeads = DEFAULT_FIELD_MAPPINGS[provider].leads;
  const defaultAppFields = new Set(Object.keys(defaultLeads));
  const mapping = currentMapping?.leads ?? defaultLeads;

  return Object.entries(mapping).map(([appField, crmField]) => ({
    tempId: generateTempId(),
    appField,
    crmField,
    isSystem: defaultAppFields.has(appField),
  }));
}

interface FieldAssociationSettingsProps {
  connections: CrmConnectionSafe[];
}

function ProviderMappingTable({
  provider,
  currentMapping,
}: {
  provider: CrmProvider;
  currentMapping: FieldMapping | null;
}) {
  const [rows, setRows] = useState<MappingRow[]>(() =>
    buildInitialRows(provider, currentMapping),
  );
  const [isPending, startTransition] = useTransition();
  const [crmFields, setCrmFields] = useState<CrmFieldOption[]>([]);
  const [appFields, setAppFields] = useState<Array<{ value: string; label: string; isCustom?: boolean }>>([...APP_LEAD_FIELDS]);
  const [isLoadingFields, setIsLoadingFields] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchCrmFields(provider),
      fetchAppFieldsWithCustom(),
    ]).then(([crmResult, appResult]) => {
      if (crmResult.success && crmResult.data.length > 0) {
        setCrmFields(crmResult.data);
      } else {
        setCrmFields(CRM_TARGET_FIELDS[provider]);
      }
      if (appResult.success) {
        setAppFields(appResult.data);
      }
    }).catch(() => {
      setCrmFields(CRM_TARGET_FIELDS[provider]);
    }).finally(() => {
      setIsLoadingFields(false);
    });
  }, [provider]);

  const targetFields = crmFields.length > 0 ? crmFields : CRM_TARGET_FIELDS[provider];
  const usedAppFields = new Set(rows.map((r) => r.appField).filter(Boolean));

  function addRow() {
    setRows((prev) => [
      ...prev,
      { tempId: generateTempId(), appField: '', crmField: '', isSystem: false },
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
    for (const row of rows) {
      if (!row.appField || !row.crmField) {
        toast.error('Preencha todos os campos antes de salvar');
        return;
      }
    }

    const usedFields = rows.map((r) => r.appField);
    const duplicates = usedFields.filter((f, i) => usedFields.indexOf(f) !== i);
    if (duplicates.length > 0) {
      const label =
        appFields.find((f) => f.value === duplicates[0])?.label ?? duplicates[0];
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
      } else {
        toast.error(result.error);
      }
    });
  }

  if (isLoadingFields) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
        <span className="ml-2 text-sm text-[var(--muted-foreground)]">Carregando campos...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-[var(--muted)]/50">
              <th className="p-3 text-left text-sm font-medium">
                Campo {PROVIDER_NAMES[provider]}
              </th>
              <th className="p-3 text-center text-sm font-medium w-8" />
              <th className="p-3 text-left text-sm font-medium">Campo Enriquece AI</th>
              <th className="p-3 text-right text-sm font-medium w-12" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.tempId} className="border-b last:border-0">
                <td className="p-2">
                  <Select
                    value={row.crmField}
                    onValueChange={(v) => updateRow(row.tempId, { crmField: v })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {targetFields.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}{'isCustom' in f && f.isCustom ? ' (custom)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="p-2 text-center">
                  <ArrowRight className="mx-auto h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                </td>
                <td className="p-2">
                  <Select
                    value={row.appField}
                    onValueChange={(v) => updateRow(row.tempId, { appField: v })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {appFields.map((f) => (
                        <SelectItem
                          key={f.value}
                          value={f.value}
                          disabled={usedAppFields.has(f.value) && row.appField !== f.value}
                        >
                          {f.label}{f.isCustom ? ' (personalizado)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="p-2 text-right">
                  {row.isSystem ? (
                    <div className="flex h-8 w-8 items-center justify-center">
                      <Lock className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                    </div>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => removeRow(row.tempId)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={addRow}>
          <Plus className="mr-1 h-4 w-4" />
          Adicionar campo
        </Button>
        <Button onClick={handleSave} disabled={isPending}>
          <Save className="mr-2 h-4 w-4" />
          {isPending ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}

export function FieldAssociationSettings({ connections }: FieldAssociationSettingsProps) {
  const connectedCrms = connections.filter((c) => c.status === 'connected');

  if (connectedCrms.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Associação de Campos</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Configure o mapeamento entre campos do CRM e do Enriquece AI.
          </p>
        </div>

        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] py-16">
          <Link2Off className="h-12 w-12 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          <h3 className="mt-4 text-lg font-medium">Nenhum CRM conectado</h3>
          <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Conecte um CRM para configurar a associação de campos.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/settings/integrations">Ir para Integrações</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (connectedCrms.length === 1) {
    const conn = connectedCrms[0]!;
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Associação de Campos</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Configure o mapeamento entre campos do {PROVIDER_NAMES[conn.crm_provider]} e do Enriquece AI.
          </p>
        </div>

        <ProviderMappingTable
          provider={conn.crm_provider}
          currentMapping={conn.field_mapping}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Associação de Campos</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Configure o mapeamento entre campos do CRM e do Enriquece AI.
        </p>
      </div>

      <Tabs defaultValue={connectedCrms[0]!.crm_provider}>
        <TabsList>
          {connectedCrms.map((conn) => (
            <TabsTrigger
              key={conn.id}
              value={conn.crm_provider}
              className="data-[state=active]:bg-red-600 data-[state=active]:text-white dark:data-[state=active]:bg-red-600 dark:data-[state=active]:text-white"
            >
              {PROVIDER_NAMES[conn.crm_provider]}
            </TabsTrigger>
          ))}
        </TabsList>
        {connectedCrms.map((conn) => (
          <TabsContent key={conn.id} value={conn.crm_provider}>
            <ProviderMappingTable
              provider={conn.crm_provider}
              currentMapping={conn.field_mapping}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
