'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import { cancelPairingSession, createPairingSession, getPairingStatus } from '../actions/pairing';
import { subscribeSessionEvents } from '../voice-call-media';
import { QrCode } from './QrCode';

export interface PairTarget {
  userId: string;
  name: string;
  mode: 'pair' | 'repair';
  sid: string | null;
}

type Phase = 'starting' | 'awaiting' | 'connected' | 'error';

/**
 * Fluxo de pareamento. Montado via `key` por tentativa, então o estado inicial
 * vem do useState (sem reset síncrono dentro de efeito) — evita cascading renders.
 *
 * O QR e o estado pareado chegam via SSE (o AstraCalls não os expõe no polling):
 * `subscribeSessionEvents` entrega o QR (string `wa.me/...`) e sinaliza quando o
 * `sid` aparece pareado; aí `getPairingStatus` persiste o número + `connected`.
 */
function PairFlow({ target, onConnected }: { target: PairTarget; onConnected: () => void }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('starting');
  const [qr, setQr] = useState<string | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const startedRef = useRef(false);
  const confirmingRef = useRef(false);
  const sidRef = useRef<string | null>(null);
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Inicia o pareamento na montagem (setState só dentro do callback async).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      // Sempre cria uma sessão nova (QR fresco) — a action limpa a anterior.
      const result = await createPairingSession(target.userId);
      if (!result.success) {
        setErrorMsg(result.error);
        setPhase('error');
        return;
      }
      sidRef.current = result.data.sid;
      setSid(result.data.sid);
      if (result.data.qr) setQr(result.data.qr);
      setPhase(result.data.status === 'connected' ? 'connected' : 'awaiting');
    })();
  }, [target]);

  // Ao fechar sem parear (desmontar), remove a sessão abandonada do serviço.
  useEffect(
    () => () => {
      if (sidRef.current && phaseRef.current !== 'connected') {
        void cancelPairingSession(sidRef.current);
      }
    },
    [],
  );

  // Assina o SSE enquanto aguarda o scan: recebe o QR e detecta o pareamento.
  useEffect(() => {
    if (phase !== 'awaiting' || !sid) return undefined;
    const unsubscribe = subscribeSessionEvents(sid, {
      onQr: (next) => setQr((prev) => (next !== prev ? next : prev)),
      onPaired: () => {
        if (confirmingRef.current) return;
        confirmingRef.current = true;
        void (async () => {
          // Confirma e persiste o número + status `connected` no banco.
          const result = await getPairingStatus(sid);
          if (result.success && result.data.status === 'connected') {
            setPhase('connected');
            toast.success('Número WhatsApp pareado com sucesso');
            router.refresh();
            onConnected();
          } else {
            confirmingRef.current = false;
          }
        })();
      },
      onDead: () => {
        setErrorMsg('A sessão caiu antes de parear. Tente de novo.');
        setPhase('error');
      },
    });
    return unsubscribe;
  }, [phase, sid, router, onConnected]);

  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 py-2 text-center">
      {phase === 'starting' && <p className="text-sm text-muted-foreground">Iniciando sessão…</p>}

      {phase === 'awaiting' && (
        <>
          {qr ? (
            <QrCode value={qr} />
          ) : (
            <p className="text-sm text-muted-foreground">Aguardando o QR do serviço de voz…</p>
          )}
          <p className="text-xs text-muted-foreground">
            WhatsApp → Aparelhos conectados → Conectar um aparelho.
          </p>
        </>
      )}

      {phase === 'connected' && (
        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">✓ Número pareado!</p>
      )}

      {phase === 'error' && <p className="text-sm text-destructive">{errorMsg ?? 'Erro ao parear.'}</p>}
    </div>
  );
}

export function PairNumberDialog({
  target,
  open,
  onOpenChange,
}: {
  target: PairTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Parear número WhatsApp</DialogTitle>
          <DialogDescription>
            {target ? `Escaneie o QR com o WhatsApp do número de ${target.name}.` : ''}
          </DialogDescription>
        </DialogHeader>

        {open && target ? (
          <PairFlow
            key={`${target.userId}:${target.mode}:${target.sid ?? ''}`}
            target={target}
            onConnected={() => setTimeout(() => onOpenChange(false), 1200)}
          />
        ) : (
          <div className="min-h-[260px]" />
        )}
      </DialogContent>
    </Dialog>
  );
}
