'use client';

import { useState, useTransition } from 'react';

import { HelpCircle, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Switch } from '@/shared/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
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

import { CustomFieldDialog } from './CustomFieldDialog';

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

  function handleAddField(name: string, type: 'text' | 'number' | 'date' | 'select', options?: string[]) {
    startTransition(async () => {
      const result = await addCustomField(name, type, options);
      if (result.success) {
        setFields((prev) => [...prev, result.data]);
        setDialogOpen(false);
        toast.success('Campo adicionado');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleEditField(name: string, type: 'text' | 'number' | 'date' | 'select', options?: string[]) {
    if (!editingField) return;
    startTransition(async () => {
      const result = await updateCustomField(editingField.id, name, type, options);
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
          <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Configure a visibilidade e obrigatoriedade dos campos dos seus leads.
          </p>
        </div>

        <Tabs defaultValue="custom">
          <TabsList>
            <TabsTrigger value="custom">
              Campos personalizados
              <Badge variant="secondary" className="ml-2">
                {fields.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="standard">
              Campos padrão
              <Badge variant="secondary" className="ml-2">
                {STANDARD_FIELDS.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          {/* Tab: Custom Fields */}
          <TabsContent value="custom" className="mt-4">
            <div className="rounded-lg border border-[var(--border)] overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">
                      <div className="flex items-center justify-between">
                        <span>Nome e tipo do campo</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => {
                            setEditingField(null);
                            setDialogOpen(true);
                          }}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableHead>
                    <TableHead className="w-[120px] text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span>Obrig. ganho</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                          </TooltipTrigger>
                          <TooltipContent>{columnTooltips.required_won}</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableHead>
                    <TableHead className="w-[120px] text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span>Obrig. perdido</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                          </TooltipTrigger>
                          <TooltipContent>{columnTooltips.required_lost}</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableHead>
                    <TableHead className="w-[100px] text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span>Visível</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                          </TooltipTrigger>
                          <TooltipContent>{columnTooltips.visible}</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableHead>
                    <TableHead className="w-[50px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                        Nenhum campo personalizado cadastrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    fields.map((field) => (
                      <TableRow key={field.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div>
                              <span className="font-medium">{field.field_name}</span>
                              {isRecentField(field.created_at) && (
                                <Badge variant="default" className="ml-2 text-[10px] px-1.5 py-0">
                                  NOVO
                                </Badge>
                              )}
                              <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                                {FIELD_TYPE_LABELS[field.field_type] ?? field.field_type}
                                {field.options && field.options.length > 0 && (
                                  <span className="ml-1">({field.options.join(', ')})</span>
                                )}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={field.is_required_won}
                            onCheckedChange={(v) => handleCustomToggle(field.id, 'is_required_won', v)}
                            disabled={isPending}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={field.is_required_lost}
                            onCheckedChange={(v) => handleCustomToggle(field.id, 'is_required_lost', v)}
                            disabled={isPending}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={field.is_visible}
                            onCheckedChange={(v) => handleCustomToggle(field.id, 'is_visible', v)}
                            disabled={isPending}
                          />
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditingField(field);
                                  setDialogOpen(true);
                                }}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDelete(field.id)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* Tab: Standard Fields */}
          <TabsContent value="standard" className="mt-4">
            <div className="rounded-lg border border-[var(--border)] overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Nome do campo</TableHead>
                    <TableHead className="w-[120px] text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span>Obrig. ganho</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                          </TooltipTrigger>
                          <TooltipContent>{columnTooltips.required_won}</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableHead>
                    <TableHead className="w-[120px] text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span>Obrig. perdido</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                          </TooltipTrigger>
                          <TooltipContent>{columnTooltips.required_lost}</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableHead>
                    <TableHead className="w-[100px] text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span>Visível</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                          </TooltipTrigger>
                          <TooltipContent>{columnTooltips.visible}</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {STANDARD_FIELDS.map((field) => {
                    const setting = getStdSetting(field.key);
                    return (
                      <TableRow key={field.key}>
                        <TableCell>
                          <span className="font-medium">{field.label}</span>
                          <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                            {field.key}
                          </p>
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={setting?.is_required_won ?? false}
                            onCheckedChange={(v) => handleStdToggle(field.key, 'is_required_won', v)}
                            disabled={isPending}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={setting?.is_required_lost ?? false}
                            onCheckedChange={(v) => handleStdToggle(field.key, 'is_required_lost', v)}
                            disabled={isPending}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={setting?.is_visible ?? true}
                            onCheckedChange={(v) => handleStdToggle(field.key, 'is_visible', v)}
                            disabled={isPending}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
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
            title="Editar campo personalizado"
          />
        )}
      </div>
    </TooltipProvider>
  );
}
