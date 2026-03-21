'use client';

import { useState, useTransition } from 'react';

import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

import { addPhoneBlacklist, deletePhoneBlacklist } from '../actions/call-settings-crud';
import type { PhoneBlacklistRow } from '../types';

interface PhoneBlacklistSettingsProps {
  initial: PhoneBlacklistRow[];
}

export function PhoneBlacklistSettings({ initial }: PhoneBlacklistSettingsProps) {
  const [entries, setEntries] = useState<PhoneBlacklistRow[]>(initial);
  const [newPattern, setNewPattern] = useState('');
  const [newReason, setNewReason] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    if (!newPattern.trim()) return;
    startTransition(async () => {
      const result = await addPhoneBlacklist({
        phone_pattern: newPattern,
        reason: newReason || undefined,
      });
      if (result.success) {
        setEntries((prev) => [...prev, result.data]);
        setNewPattern('');
        setNewReason('');
        toast.success('Telefone adicionado à blacklist');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deletePhoneBlacklist(id);
      if (result.success) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        toast.success('Telefone removido');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Blacklist de Telefones</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Padrões de telefone bloqueados não serão utilizados em ligações automáticas.
        </p>
      </div>

      {/* Add pattern */}
      <div className="flex items-end gap-2">
        <div className="flex-1 max-w-xs">
          <label className="block text-sm font-medium mb-1">Padrão de telefone</label>
          <Input
            placeholder="+5511999* ou 0800*"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
        </div>
        <div className="flex-1 max-w-xs">
          <label className="block text-sm font-medium mb-1">Motivo (opcional)</label>
          <Input
            placeholder="Spam, não perturbe..."
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
        </div>
        <Button onClick={handleAdd} disabled={isPending || !newPattern.trim()} size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Adicionar
        </Button>
      </div>

      {/* List */}
      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
        {entries.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Nenhum telefone na blacklist.
          </p>
        ) : (
          <ul>
            {entries.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 last:border-0"
              >
                <div>
                  <span className="text-sm font-mono">{item.phone_pattern}</span>
                  {item.reason && (
                    <span className="ml-2 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                      — {item.reason}
                    </span>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(item.id)}
                  disabled={isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
