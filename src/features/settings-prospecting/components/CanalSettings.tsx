'use client';

import { useState, useTransition } from 'react';

import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

import {
  addCanalOption,
  deleteCanalOption,
  type CanalOptionRow,
  updateCanalOption,
} from '../actions/canal-crud';

interface CanalSettingsProps {
  initial: CanalOptionRow[];
}

export function CanalSettings({ initial }: CanalSettingsProps) {
  const [canals, setCanals] = useState<CanalOptionRow[]>(initial);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const result = await addCanalOption(newName);
      if (result.success) {
        setCanals((prev) => [...prev, result.data]);
        setNewName('');
        toast.success('Canal adicionado');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleStartEdit(canal: CanalOptionRow) {
    setEditingId(canal.id);
    setEditName(canal.name);
  }

  function handleSaveEdit(id: string) {
    if (!editName.trim()) return;
    startTransition(async () => {
      const result = await updateCanalOption(id, editName);
      if (result.success) {
        setCanals((prev) =>
          prev.map((c) => (c.id === id ? result.data : c)),
        );
        setEditingId(null);
        toast.success('Canal atualizado');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteCanalOption(id);
      if (result.success) {
        setCanals((prev) => prev.filter((c) => c.id !== id));
        toast.success('Canal removido');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Canais de Aquisição</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gerencie os canais disponíveis para classificar a origem dos leads.
        </p>
      </div>

      {/* Add new */}
      <div className="flex gap-2">
        <Input
          placeholder="Nome do canal (ex: YouTube, Evento)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          disabled={isPending}
          className="max-w-sm"
        />
        <Button onClick={handleAdd} disabled={isPending || !newName.trim()}>
          <Plus className="mr-2 h-4 w-4" />
          Adicionar
        </Button>
      </div>

      {/* List */}
      <div className="divide-y rounded-lg border">
        {canals.map((canal) => (
          <div key={canal.id} className="flex items-center gap-3 px-4 py-3">
            {editingId === canal.id ? (
              <>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit(canal.id)}
                  className="max-w-sm"
                  autoFocus
                />
                <Button size="sm" onClick={() => handleSaveEdit(canal.id)} disabled={isPending}>
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm">{canal.name}</span>
                <Button size="sm" variant="ghost" onClick={() => handleStartEdit(canal)} disabled={isPending}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(canal.id)} disabled={isPending}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        ))}
        {canals.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhum canal cadastrado. Adicione o primeiro acima.
          </div>
        )}
      </div>
    </div>
  );
}
