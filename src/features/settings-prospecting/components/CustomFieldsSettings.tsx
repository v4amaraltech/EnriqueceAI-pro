'use client';

import { useState, useTransition } from 'react';

import { Check, HelpCircle, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

import {
  addCustomField,
  deleteCustomField,
  updateCustomField,
  updateCustomFieldSettings,
} from '../actions/custom-fields-crud';
import type { CustomFieldRow } from '../types/custom-field';
import {
  type StandardFieldSettingRow,
  upsertStandardFieldSetting,
} from '../actions/standard-field-settings';
import { STANDARD_FIELDS } from '../constants/standard-fields';

import { CustomFieldDialog, type CustomFieldSettings } from './CustomFieldDialog';
import { StandardFieldOptionsDialog } from './StandardFieldOptionsDialog';

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Texto',
  number: 'Número',
  date: 'Data',
  select: 'Seleção',
};

function isRecentField(createdAt: string): boolean {
  const created = new Date(createdAt);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return created > sevenDaysAgo;
}

function CheckToggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--accent)]'}`}
      disabled={disabled}
    >
      {checked && <Check className="h-5 w-5 text-foreground" strokeWidth={2.5} />}
    </button>
  );
}

function ColumnHeader({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      <span>{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </div>
  );
}

interface CustomFieldsSettingsProps {
  initial: CustomFieldRow[];
  standardSettings: StandardFieldSettingRow[];
}

export function CustomFieldsSettings({ initial, standardSettings }: CustomFieldsSettingsProps) {
  const [fields, setFields] = useState<CustomFieldRow[]>(initial);
  const [stdSettings, setStdSettings] = useState<StandardFieldSettingRow[]>(standardSettings);
  const [isPending, startTransition] = useTransition();

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomFieldRow | null>(null);

  // Standard field options dialog state
  const [stdOptionsDialogOpen, setStdOptionsDialogOpen] = useState(false);
  const [editingStdFieldKey, setEditingStdFieldKey] = useState<string | null>(null);

  // Helpers for standard field settings
  function getStdSetting(fieldKey: string) {
    return stdSettings.find((s) => s.field_key === fieldKey);
  }

  function handleStdToggle(
    fieldKey: string,
    prop: 'is_visible' | 'is_required_won' | 'is_required_lost',
    value: boolean,
  ) {
    const current = getStdSetting(fieldKey);
    const update = {
      is_visible: current?.is_visible ?? true,
      is_required_won: current?.is_required_won ?? false,
      is_required_lost: current?.is_required_lost ?? false,
      [prop]: value,
    };

    // Optimistic update
    setStdSettings((prev) => {
      const existing = prev.find((s) => s.field_key === fieldKey);
      if (existing) {
        return prev.map((s) => (s.field_key === fieldKey ? { ...s, ...update } : s));
      }
      return [...prev, { id: '', org_id: '', field_key: fieldKey, ...update } as StandardFieldSettingRow];
    });

    startTransition(async () => {
      const result = await upsertStandardFieldSetting(fieldKey, update);
      if (!result.success) {
        toast.error(result.error);
        // Revert optimistic update
        setStdSettings((prev) => prev.filter((s) => s.field_key !== fieldKey || s.id !== ''));
      }
    });
  }

  function getStdFieldOptions(fieldKey: string): string[] {
    const setting = getStdSetting(fieldKey);
    if (setting?.options && setting.options.length > 0) return setting.options;
    const fieldDef = STANDARD_FIELDS.find((f) => f.key === fieldKey);
    return fieldDef?.defaultOptions ?? [];
  }

  function handleSaveStdOptions(fieldKey: string, options: string[]) {
    // Optimistic update
    setStdSettings((prev) => {
      const existing = prev.find((s) => s.field_key === fieldKey);
      if (existing) {
        return prev.map((s) => (s.field_key === fieldKey ? { ...s, options } : s));
      }
      return [...prev, { id: '', org_id: '', field_key: fieldKey, is_visible: true, is_required_won: false, is_required_lost: false, options } as StandardFieldSettingRow];
    });
    setStdOptionsDialogOpen(false);

    startTransition(async () => {
      const result = await upsertStandardFieldSetting(fieldKey, { options });
      if (!result.success) {
        toast.error(result.error);
      }
    });
  }

  function handleCustomToggle(
    id: string,
    prop: 'is_visible' | 'is_required_won' | 'is_required_lost',
    value: boolean,
  ) {
    // Optimistic update
    setFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, [prop]: value } : f)),
    );

    startTransition(async () => {
      const result = await updateCustomFieldSettings(id, { [prop]: value });
      if (!result.success) {
        toast.error(result.error);
        // Revert
        setFields((prev) =>
          prev.map((f) => (f.id === id ? { ...f, [prop]: !value } : f)),
        );
      }
    });
  }

  function handleAddField(name: string, type: 'text' | 'number' | 'date' | 'select', options: string[] | undefined, settings: CustomFieldSettings) {
    startTransition(async () => {
      const result = await addCustomField(name, type, options, settings);
      if (result.success) {
        setFields((prev) => [...prev, result.data]);
        setDialogOpen(false);
        toast.success('Campo adicionado');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleEditField(name: string, type: 'text' | 'number' | 'date' | 'select', options: string[] | undefined, settings: CustomFieldSettings) {
    if (!editingField) return;
    startTransition(async () => {
      const result = await updateCustomField(editingField.id, name, type, options, settings);
      if (result.success) {
        setFields((prev) => prev.map((f) => (f.id === editingField.id ? result.data : f)));
        setEditingField(null);
        toast.success('Campo atualizado');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm('Tem certeza que deseja excluir este campo? Dados preenchidos nos leads serão perdidos.')) return;
    startTransition(async () => {
      const result = await deleteCustomField(id);
      if (result.success) {
        setFields((prev) => prev.filter((f) => f.id !== id));
        toast.success('Campo removido');
      } else {
        toast.error(result.error);
      }
    });
  }

  const columnTooltips = {
    required_won: 'Torna o campo obrigatório ao marcar um lead como "ganho"',
    required_lost: 'Torna o campo obrigatório ao marcar um lead como "perdido"',
    visible: 'Controla se o campo aparece no painel de detalhes do lead',
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Campos Personalizados</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure a visibilidade e obrigatoriedade dos campos dos seus leads.
          </p>
        </div>

        <Tabs defaultValue="custom">
          <TabsList>
            <TabsTrigger value="custom">
              Campos personalizados
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                {fields.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="standard">
              Campos padrão
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                {STANDARD_FIELDS.length}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Tab: Custom Fields */}
          <TabsContent value="custom" className="mt-6">
            {/* Header row */}
            <div className="flex items-center border-b border-border pb-3 text-sm font-medium text-muted-foreground">
              <div className="flex-1">Nome e tipo do campo</div>
              <div className="w-[180px] text-center">
                <ColumnHeader label="Obrigatório para ganho" tooltip={columnTooltips.required_won} />
              </div>
              <div className="w-[180px] text-center">
                <ColumnHeader label="Obrigatório para perdido" tooltip={columnTooltips.required_lost} />
              </div>
              <div className="w-[160px] text-center">
                <ColumnHeader label="Visível no formulário" tooltip={columnTooltips.visible} />
              </div>
              <div className="w-10 flex justify-end">
                <button
                  type="button"
                  onClick={() => { setEditingField(null); setDialogOpen(true); }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Rows */}
            {fields.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Nenhum campo personalizado cadastrado.
              </div>
            ) : (
              fields.map((field) => (
                <div key={field.id} className="flex items-center border-b border-border py-5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="font-medium hover:underline text-left"
                        onClick={() => { setEditingField(field); setDialogOpen(true); }}
                      >
                        {field.field_name}
                      </button>
                      {isRecentField(field.created_at) && (
                        <Badge className="text-[10px] px-1.5 py-0 bg-blue-500 text-white border-0">
                          NOVO
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {FIELD_TYPE_LABELS[field.field_type] ?? field.field_type}
                    </p>
                    {field.field_type === 'select' && field.options && field.options.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {field.options.slice(0, 5).map((opt) => (
                          <Badge key={opt} variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                            {opt}
                          </Badge>
                        ))}
                        {field.options.length > 5 && (
                          <button
                            type="button"
                            className="text-[10px] text-primary hover:underline"
                            onClick={() => { setEditingField(field); setDialogOpen(true); }}
                          >
                            +{field.options.length - 5} mais
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="w-[180px] flex justify-center">
                    <CheckToggle checked={field.is_required_won} onChange={(v) => handleCustomToggle(field.id, 'is_required_won', v)} disabled={isPending} />
                  </div>
                  <div className="w-[180px] flex justify-center">
                    <CheckToggle checked={field.is_required_lost} onChange={(v) => handleCustomToggle(field.id, 'is_required_lost', v)} disabled={isPending} />
                  </div>
                  <div className="w-[160px] flex justify-center">
                    <CheckToggle checked={field.is_visible} onChange={(v) => handleCustomToggle(field.id, 'is_visible', v)} disabled={isPending} />
                  </div>
                  <div className="w-10 flex justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditingField(field); setDialogOpen(true); }}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDelete(field.id)} className="text-destructive focus:text-destructive">
                          <Trash2 className="mr-2 h-4 w-4" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          {/* Tab: Standard Fields */}
          <TabsContent value="standard" className="mt-6">
            {/* Header row */}
            <div className="flex items-center border-b border-border pb-3 text-sm font-medium text-muted-foreground">
              <div className="flex-1">Nome e tipo do campo</div>
              <div className="w-[180px] text-center">
                <ColumnHeader label="Obrigatório para ganho" tooltip={columnTooltips.required_won} />
              </div>
              <div className="w-[180px] text-center">
                <ColumnHeader label="Obrigatório para perdido" tooltip={columnTooltips.required_lost} />
              </div>
              <div className="w-[160px] text-center">
                <ColumnHeader label="Visível no formulário" tooltip={columnTooltips.visible} />
              </div>
            </div>

            {/* Rows */}
            {STANDARD_FIELDS.map((field) => {
              const setting = getStdSetting(field.key);
              const isSelect = field.type === 'select';
              const fieldOptions = isSelect ? getStdFieldOptions(field.key) : [];
              return (
                <div key={field.key} className="flex items-center border-b border-border py-5">
                  <div className="flex-1 min-w-0">
                    {isSelect ? (
                      <button
                        type="button"
                        className="font-medium hover:underline text-left"
                        onClick={() => { setEditingStdFieldKey(field.key); setStdOptionsDialogOpen(true); }}
                      >
                        {field.label}
                      </button>
                    ) : (
                      <span className="font-medium">{field.label}</span>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {field.key}{isSelect ? ` \u00B7 ${FIELD_TYPE_LABELS.select}` : ''}
                    </p>
                    {isSelect && fieldOptions.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {fieldOptions.slice(0, 5).map((opt) => (
                          <Badge key={opt} variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                            {opt}
                          </Badge>
                        ))}
                        {fieldOptions.length > 5 && (
                          <button
                            type="button"
                            className="text-[10px] text-primary hover:underline"
                            onClick={() => { setEditingStdFieldKey(field.key); setStdOptionsDialogOpen(true); }}
                          >
                            +{fieldOptions.length - 5} mais
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="w-[180px] flex justify-center">
                    <CheckToggle checked={setting?.is_required_won ?? false} onChange={(v) => handleStdToggle(field.key, 'is_required_won', v)} disabled={isPending} />
                  </div>
                  <div className="w-[180px] flex justify-center">
                    <CheckToggle checked={setting?.is_required_lost ?? false} onChange={(v) => handleStdToggle(field.key, 'is_required_lost', v)} disabled={isPending} />
                  </div>
                  <div className="w-[160px] flex justify-center">
                    <CheckToggle checked={setting?.is_visible ?? true} onChange={(v) => handleStdToggle(field.key, 'is_visible', v)} disabled={isPending} />
                  </div>
                </div>
              );
            })}
          </TabsContent>
        </Tabs>

        {/* Create / Edit Dialog */}
        {dialogOpen && !editingField && (
          <CustomFieldDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            onSave={handleAddField}
            isPending={isPending}
          />
        )}
        {dialogOpen && editingField && (
          <CustomFieldDialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) setEditingField(null);
            }}
            onSave={handleEditField}
            isPending={isPending}
            initialName={editingField.field_name}
            initialType={editingField.field_type}
            initialOptions={editingField.options ?? undefined}
            initialSettings={{
              is_visible: editingField.is_visible,
              is_required_won: editingField.is_required_won,
              is_required_lost: editingField.is_required_lost,
            }}
            title="Editar campo personalizado"
          />
        )}

        {/* Standard field options dialog */}
        {stdOptionsDialogOpen && editingStdFieldKey && (
          <StandardFieldOptionsDialog
            open={stdOptionsDialogOpen}
            onOpenChange={(open) => {
              setStdOptionsDialogOpen(open);
              if (!open) setEditingStdFieldKey(null);
            }}
            fieldLabel={STANDARD_FIELDS.find((f) => f.key === editingStdFieldKey)?.label ?? editingStdFieldKey}
            initialOptions={getStdFieldOptions(editingStdFieldKey)}
            onSave={(options) => handleSaveStdOptions(editingStdFieldKey, options)}
            isPending={isPending}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
