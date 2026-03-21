'use client';

import { useState, useTransition } from 'react';

import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

import {
  addLossReason,
  deleteLossReason,
  type LossReasonRow,
  updateLossReason,
} from '../actions/loss-reasons-crud';

interface LossReasonsSettingsProps {
  initial: LossReasonRow[];
}

export function LossReasonsSettings({ initial }: LossReasonsSettingsProps) {
  const [reasons, setReasons] = useState<LossReasonRow[]>(initial);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const result = await addLossReason(newName);
      if (result.success) {
        setReasons((prev) => [...prev, result.data]);
        setNewName('');
        toast.success('Motivo adicionado');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleStartEdit(reason: LossReasonRow) {
    setEditingId(reason.id);
    setEditName(reason.name);
  }

  function handleSaveEdit(id: string) {
    if (!editName.trim()) return;
    startTransition(async () => {
      const result = await updateLossReason(id, editName);
      if (result.success) {
        setReasons((prev) =>
          prev.map((r) => (r.id === id ? result.data : r)),
        );
        setEditingId(null);
        toast.success('Motivo atualizado');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteLossReason(id);
      if (result.success) {
        setReasons((prev) => prev.filter((r) => r.id !== id));
        toast.success('Motivo removido');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Motivos de Perda</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Gerencie os motivos de perda disponíveis ao encerrar uma cadência.
        </p>
      </div>

      {/* Add new */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Novo motivo de perda..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="max-w-sm"
        />
        <Button onClick={handleAdd} disabled={isPending || !newName.trim()} size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Adicionar
        </Button>
      </div>

      {/* List */}
      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
        {reasons.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Nenhum motivo de perda cadastrado.
          </p>
        ) : (
          <ul>
            {reasons.map((reason) => (
              <li
                key={reason.id}
                className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 last:border-0"
              >
                {editingId === reason.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(reason.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="max-w-sm"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      onClick={() => handleSaveEdit(reason.id)}
                      disabled={isPending}
                    >
                      Salvar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{reason.name}</span>
                      {reason.is_system && (
                        <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                          padrão
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => handleStartEdit(reason)}
                        disabled={isPending}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {!reason.is_system && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(reason.id)}
                          disabled={isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
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
