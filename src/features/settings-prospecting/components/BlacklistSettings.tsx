'use client';

import { useState, useTransition } from 'react';

import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

import {
  addBlacklistDomain,
  deleteBlacklistDomain,
  type EmailBlacklistRow,
} from '../actions/email-blacklist-crud';

interface BlacklistSettingsProps {
  initial: EmailBlacklistRow[];
}

export function BlacklistSettings({ initial }: BlacklistSettingsProps) {
  const [domains, setDomains] = useState<EmailBlacklistRow[]>(initial);
  const [newDomain, setNewDomain] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    if (!newDomain.trim()) return;
    startTransition(async () => {
      const result = await addBlacklistDomain(newDomain);
      if (result.success) {
        setDomains((prev) => [...prev, result.data]);
        setNewDomain('');
        toast.success('Domínio adicionado à blacklist');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteBlacklistDomain(id);
      if (result.success) {
        setDomains((prev) => prev.filter((d) => d.id !== id));
        toast.success('Domínio removido');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Blacklist de E-mails</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Domínios na blacklist serão ignorados ao enviar e-mails de prospecção.
        </p>
      </div>

      {/* Add domain */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="exemplo.com.br"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="max-w-sm"
        />
        <Button onClick={handleAdd} disabled={isPending || !newDomain.trim()} size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Adicionar
        </Button>
      </div>

      {/* List */}
      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
        {domains.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Nenhum domínio na blacklist.
          </p>
        ) : (
          <ul>
            {domains.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 last:border-0"
              >
                <span className="text-sm font-mono">{item.domain}</span>
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
