'use client';

import { useState, useTransition } from 'react';

import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import {
  addCustomField,
  type CustomFieldRow,
  deleteCustomField,
  updateCustomField,
} from '../actions/custom-fields-crud';

const FIELD_TYPES = [
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'date', label: 'Data' },
  { value: 'select', label: 'Seleção' },
] as const;

interface CustomFieldsSettingsProps {
  initial: CustomFieldRow[];
}

export function CustomFieldsSettings({ initial }: CustomFieldsSettingsProps) {
  const [fields, setFields] = useState<CustomFieldRow[]>(initial);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'text' | 'number' | 'date' | 'select'>('text');
  const [newOptionsList, setNewOptionsList] = useState<string[]>(['']);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<'text' | 'number' | 'date' | 'select'>('text');
  const [editOptionsList, setEditOptionsList] = useState<string[]>(['']);
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    if (!newName.trim()) return;
    const opts = newType === 'select' ? newOptionsList.map((o) => o.trim()).filter(Boolean) : undefined;
    if (newType === 'select' && (!opts || opts.length === 0)) {
      toast.error('Adicione pelo menos uma opção');
      return;
    }
    startTransition(async () => {
      const result = await addCustomField(newName, newType, opts);
      if (result.success) {
        setFields((prev) => [...prev, result.data]);
        setNewName('');
        setNewType('text');
        setNewOptionsList(['']);
        toast.success('Campo adicionado');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleStartEdit(field: CustomFieldRow) {
    setEditingId(field.id);
    setEditName(field.field_name);
    setEditType(field.field_type);
    setEditOptionsList(field.options && field.options.length > 0 ? [...field.options] : ['']);
  }

  function handleSaveEdit(id: string) {
    if (!editName.trim()) return;
    const opts = editType === 'select' ? editOptionsList.map((o) => o.trim()).filter(Boolean) : undefined;
    if (editType === 'select' && (!opts || opts.length === 0)) {
      toast.error('Adicione pelo menos uma opção');
      return;
    }
    startTransition(async () => {
      const result = await updateCustomField(id, editName, editType, opts);
      if (result.success) {
        setFields((prev) => prev.map((f) => (f.id === id ? result.data : f)));
        setEditingId(null);
        toast.success('Campo atualizado');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete(id: string) {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Campos Personalizados</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Crie campos personalizados para enriquecer os dados dos seus leads.
        </p>
      </div>

      {/* Add new field */}
      <div className="space-y-3 rounded-lg border border-[var(--border)] p-4">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">Nome do campo</label>
            <Input
              placeholder="Ex: Segmento, Cargo..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="max-w-sm"
            />
          </div>
          <div className="w-40">
            <label className="mb-1 block text-sm font-medium">Tipo</label>
            <Select value={newType} onValueChange={(v) => { setNewType(v as typeof newType); if (v === 'select') setNewOptionsList((prev) => prev.length === 0 ? [''] : prev); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAdd} disabled={isPending || !newName.trim()} size="sm">
            <Plus className="mr-1 h-4 w-4" />
            Adicionar
          </Button>
        </div>
        {newType === 'select' && (
          <div className="space-y-2">
            <label className="block text-sm font-medium">Adicione as opções</label>
            {newOptionsList.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="w-6 text-right text-sm text-[var(--muted-foreground)]">{idx + 1}</span>
                <Input
                  placeholder={`Opção ${idx + 1}`}
                  value={opt}
                  onChange={(e) => {
                    const updated = [...newOptionsList];
                    updated[idx] = e.target.value;
                    setNewOptionsList(updated);
                  }}
                  className="max-w-sm"
                />
                {newOptionsList.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setNewOptionsList((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewOptionsList((prev) => [...prev, ''])}
            >
              <Plus className="mr-1 h-4 w-4" />
              Adicionar opção
            </Button>
          </div>
        )}
      </div>

      {/* List */}
      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
        {fields.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Nenhum campo personalizado cadastrado.
          </p>
        ) : (
          <ul>
            {fields.map((field) => (
              <li
                key={field.id}
                className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 last:border-0"
              >
                {editingId === field.id ? (
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(field.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="max-w-sm"
                        autoFocus
                      />
                      <Select value={editType} onValueChange={(v) => setEditType(v as typeof editType)}>
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" onClick={() => handleSaveEdit(field.id)} disabled={isPending}>
                        Salvar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {editType === 'select' && (
                      <div className="space-y-2">
                        <label className="block text-sm font-medium">Opções</label>
                        {editOptionsList.map((opt, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="w-6 text-right text-sm text-[var(--muted-foreground)]">{idx + 1}</span>
                            <Input
                              placeholder={`Opção ${idx + 1}`}
                              value={opt}
                              onChange={(e) => {
                                const updated = [...editOptionsList];
                                updated[idx] = e.target.value;
                                setEditOptionsList(updated);
                              }}
                              className="max-w-sm"
                            />
                            {editOptionsList.length > 1 && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setEditOptionsList((prev) => prev.filter((_, i) => i !== idx))}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditOptionsList((prev) => [...prev, ''])}
                        >
                          <Plus className="mr-1 h-4 w-4" />
                          Adicionar opção
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{field.field_name}</span>
                      <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                        {FIELD_TYPES.find((t) => t.value === field.field_type)?.label ?? field.field_type}
                      </span>
                      {field.options && field.options.length > 0 && (
                        <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                          ({field.options.join(', ')})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => handleStartEdit(field)}
                        disabled={isPending}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(field.id)}
                        disabled={isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
