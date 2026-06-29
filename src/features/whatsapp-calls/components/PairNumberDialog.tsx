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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const startedRef = useRef(false);
  const confirmingRef = useRef(false);
  const sidRef = useRef<string | null>(null);
  const phaseRef = useRef<Phase>(phase);
  const onConnectedRef = useRef(onConnected);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

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
      // O SSE (aberto na montagem) talvez já tenha trazido o QR — não o sobrescreve.
      if (result.data.qr) setQr((prev) => prev ?? result.data.qr);
      setPhase((prev) =>
        prev === 'error' ? prev : result.data.status === 'connected' ? 'connected' : 'awaiting',
      );
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

  // Assina o SSE JÁ NA MONTAGEM — em paralelo à criação da sessão — para não
  // perder o primeiro QR (broadcast incremental do serviço). O QR vem global; o
  // `paired`/`dead` só passam a valer quando `sidRef.current` já existe.
  useEffect(() => {
    const unsubscribe = subscribeSessionEvents(() => sidRef.current, {
      onQr: (next) => setQr((prev) => (next !== prev ? next : prev)),
      onPaired: () => {
        if (confirmingRef.current) return;
        const sid = sidRef.current;
        if (!sid) return;
        confirmingRef.current = true;
        void (async () => {
          // Confirma e persiste o número + status `connected` no banco.
          const result = await getPairingStatus(sid);
          if (result.success && result.data.status === 'connected') {
            setPhase('connected');
            toast.success('Número WhatsApp pareado com sucesso');
            router.refresh();
            onConnectedRef.current();
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
    // Montagem única (handlers via ref); router do Next é referencialmente estável.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
