'use client';

import { useState, useTransition } from 'react';

import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

import {
  addCloser,
  deleteCloser,
  type CloserRow,
  updateCloser,
} from '../actions/closers-crud';

interface ClosersSettingsProps {
  initial: CloserRow[];
}

export function ClosersSettings({ initial }: ClosersSettingsProps) {
  const [closers, setClosers] = useState<CloserRow[]>(initial);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    if (!newName.trim() || !newEmail.trim()) return;
    startTransition(async () => {
      const result = await addCloser(newName, newEmail);
      if (result.success) {
        setClosers((prev) => [...prev, result.data].sort((a, b) => a.name.localeCompare(b.name)));
        setNewName('');
        setNewEmail('');
        toast.success('Closer adicionado');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleStartEdit(closer: CloserRow) {
    setEditingId(closer.id);
    setEditName(closer.name);
    setEditEmail(closer.email);
  }

  function handleSaveEdit(id: string) {
    if (!editName.trim() || !editEmail.trim()) return;
    startTransition(async () => {
      const result = await updateCloser(id, editName, editEmail);
      if (result.success) {
        setClosers((prev) =>
          prev.map((c) => (c.id === id ? result.data : c)),
        );
        setEditingId(null);
        toast.success('Closer atualizado');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteCloser(id);
      if (result.success) {
        setClosers((prev) => prev.filter((c) => c.id !== id));
        toast.success('Closer removido');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Closers</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Gerencie os closers (vendedores) que recebem leads dos pré-vendas para reuniões.
        </p>
      </div>

      {/* Add new */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Nome do closer..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="max-w-[200px]"
        />
        <Input
          type="email"
          placeholder="email@empresa.com"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="max-w-[250px]"
        />
        <Button onClick={handleAdd} disabled={isPending || !newName.trim() || !newEmail.trim()} size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Adicionar
        </Button>
      </div>

      {/* List */}
      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
        {closers.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Nenhum closer cadastrado.
          </p>
        ) : (
          <ul>
            {closers.map((closer) => (
              <li
                key={closer.id}
                className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 last:border-0"
              >
                {editingId === closer.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="max-w-[200px]"
                      autoFocus
                    />
                    <Input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(closer.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="max-w-[250px]"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleSaveEdit(closer.id)}
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
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{closer.name}</span>
                      <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                        {closer.email}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => handleStartEdit(closer)}
                        disabled={isPending}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(closer.id)}
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
