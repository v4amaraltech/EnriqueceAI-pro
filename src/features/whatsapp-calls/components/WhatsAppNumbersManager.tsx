'use client';

import { useState } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';

import type { WhatsAppCallSessionStatus, WhatsAppNumberRow } from '../types';
import { PairNumberDialog, type PairTarget } from './PairNumberDialog';

const STATUS_META: Record<WhatsAppCallSessionStatus | 'none', { label: string; className: string }> = {
  connected: { label: 'Conectado', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  pairing: { label: 'Pareando', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  disconnected: { label: 'Desconectado', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400' },
  none: { label: 'Sem número', className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-500/10 dark:text-zinc-500' },
};

export function WhatsAppNumbersManager({ rows }: { rows: WhatsAppNumberRow[] }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<PairTarget | null>(null);

  function startPairing(row: WhatsAppNumberRow) {
    const sid = row.session?.serviceSessionId ?? null;
    setTarget({
      userId: row.userId,
      name: row.name,
      mode: sid ? 'repair' : 'pair',
      sid,
    });
    setOpen(true);
  }

  return (
    <div className="rounded-lg border bg-[var(--card)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-4 py-3 font-medium">SDR</th>
            <th className="px-4 py-3 font-medium">Número</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium text-right">Ação</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                Nenhum membro ativo na organização.
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const status = row.session?.status ?? 'none';
            const meta = STATUS_META[status];
            const isConnected = status === 'connected';
            return (
              <tr key={row.userId} className="border-b last:border-0">
                <td className="px-4 py-3">
                  <span className="font-medium">{row.name}</span>
                  {row.role === 'manager' && (
                    <span className="ml-2 text-xs text-muted-foreground">(gestor)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {row.session?.phoneNumber ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className={`border-0 ${meta.className}`}>
                    {meta.label}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant={isConnected ? 'outline' : 'default'}
                    size="sm"
                    onClick={() => startPairing(row)}
                  >
                    {isConnected ? 'Reparear' : 'Parear'}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <PairNumberDialog target={target} open={open} onOpenChange={setOpen} />
    </div>
  );
}
