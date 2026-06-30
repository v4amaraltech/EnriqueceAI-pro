'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';

import {
  cancelMyPairingSession,
  createMyPairingSession,
  getMyPairingStatus,
} from '../actions/pairing-self';
import type { PairingActions } from '../pairing-types';
import type { WhatsAppCallSessionStatus } from '../types';
import type { MyWhatsAppNumber } from './MyWhatsAppNumberCard';
import { PairNumberDialog, type PairTarget } from './PairNumberDialog';
import { WhatsAppGlyph } from './WhatsAppGlyph';

// Actions escopadas ao próprio SDR (create ignora o userId — é sempre o logado).
const SELF_ACTIONS: PairingActions = {
  create: () => createMyPairingSession(),
  getStatus: (sid: string) => getMyPairingStatus(sid),
  cancel: (sid: string) => cancelMyPairingSession(sid),
};

const STATUS_META: Record<WhatsAppCallSessionStatus | 'none', { label: string; className: string }> = {
  connected: { label: 'Conectado', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  pairing: { label: 'Pareando', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' },
  disconnected: { label: 'Desconectado', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  none: { label: 'Sem número', className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
};

/**
 * Linha de "WhatsApp Call" na tela de Integrações para o SDR (não-gestor):
 * auto-pareamento do próprio número via QR, igual ao WhatsApp da Evolution.
 * Reaproveita o fluxo self-service (PairNumberDialog + pairing-self) que antes
 * só existia na página escondida /settings/my-whatsapp-number.
 */
export function MyWhatsAppCallRow({ me }: { me: MyWhatsAppNumber }) {
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
    <div className="group flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] hover:bg-[var(--muted)]/30">
      <div className="flex w-10 shrink-0 items-center justify-center">
        <WhatsAppGlyph className="h-8 w-8 text-emerald-600" />
      </div>
      <div className="w-32 shrink-0 font-medium">WhatsApp Call</div>
      <div className="min-w-0 shrink truncate text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        {isConnected && me.session?.phoneNumber
          ? `Conectado: ${me.session.phoneNumber}`
          : 'Pareie seu número WhatsApp para ligar pela plataforma'}
      </div>
      <Badge variant="outline" className={meta.className}>
        {isConnected && <Check className="mr-1 h-3 w-3" />}
        {meta.label}
      </Badge>
      <div className="ml-auto shrink-0 flex items-center gap-2">
        <Button variant={isConnected ? 'outline' : 'default'} size="sm" onClick={startPairing}>
          {isConnected ? 'Reparear' : 'Parear meu número'}
        </Button>
      </div>

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
