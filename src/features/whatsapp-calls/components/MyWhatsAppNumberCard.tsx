'use client';

import { useState } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';

import {
  cancelMyPairingSession,
  createMyPairingSession,
  getMyPairingStatus,
} from '../actions/pairing-self';
import type { PairingActions } from '../pairing-types';
import type { WhatsAppCallSessionStatus } from '../types';
import { PairNumberDialog, type PairTarget } from './PairNumberDialog';
import { WhatsAppGlyph } from './WhatsAppGlyph';

const STATUS_META: Record<WhatsAppCallSessionStatus | 'none', { label: string; className: string }> = {
  connected: { label: 'Conectado', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  pairing: { label: 'Pareando', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  disconnected: { label: 'Desconectado', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400' },
  none: { label: 'Sem número', className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-500/10 dark:text-zinc-500' },
};

// Actions escopadas ao próprio SDR (a create ignora o userId — é sempre o logado).
const SELF_ACTIONS: PairingActions = {
  create: () => createMyPairingSession(),
  getStatus: (sid: string) => getMyPairingStatus(sid),
  cancel: (sid: string) => cancelMyPairingSession(sid),
};

export interface MyWhatsAppNumber {
  userId: string;
  name: string;
  session: {
    status: WhatsAppCallSessionStatus;
    phoneNumber: string | null;
    serviceSessionId: string | null;
  } | null;
}

export function MyWhatsAppNumberCard({ me }: { me: MyWhatsAppNumber }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<PairTarget | null>(null);

  const status = me.session?.status ?? 'none';
  const meta = STATUS_META[status];
  const isConnected = status === 'connected';

  function startPairing() {
    const sid = me.session?.serviceSessionId ?? null;
    setTarget({ userId: me.userId, name: me.name, mode: sid ? 'repair' : 'pair', sid });
    setOpen(true);
  }

  return (
    <div className="rounded-lg border bg-[var(--card)] p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center">
          <WhatsAppGlyph className="h-8 w-8 text-emerald-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">Meu número WhatsApp</p>
          <p className="truncate text-sm text-muted-foreground">
            {me.session?.phoneNumber ?? 'Nenhum número pareado ainda'}
          </p>
        </div>
        <Badge variant="outline" className={`border-0 ${meta.className}`}>
          {meta.label}
        </Badge>
        <Button variant={isConnected ? 'outline' : 'default'} size="sm" onClick={startPairing}>
          {isConnected ? 'Reparear' : 'Parear meu número'}
        </Button>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Pareie um número WhatsApp dedicado para usar o discador nativo (Ligação via WhatsApp).
        Escaneie o QR com o WhatsApp do número que você vai usar para ligar.
      </p>

      <PairNumberDialog
        target={target}
        open={open}
        onOpenChange={setOpen}
        actions={SELF_ACTIONS}
        description="Escaneie o QR com o WhatsApp do número que você vai usar para ligar."
      />
    </div>
  );
}
