'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import { createPairingSession, getPairingStatus, repairSession } from '../actions/pairing';

const POLL_INTERVAL_MS = 2500;

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
 */
function PairFlow({ target, onConnected }: { target: PairTarget; onConnected: () => void }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('starting');
  const [qr, setQr] = useState<string | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Inicia o pareamento na montagem (setState só dentro do callback async).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const result =
        target.mode === 'repair' && target.sid
          ? await repairSession(target.sid)
          : await createPairingSession(target.userId);
      if (!result.success) {
        setErrorMsg(result.error);
        setPhase('error');
        return;
      }
      setSid(result.data.sid);
      setQr(result.data.qr);
      setPhase(result.data.status === 'connected' ? 'connected' : 'awaiting');
    })();
  }, [target]);

  // Polling do status enquanto aguarda o scan do QR.
  useEffect(() => {
    if (phase !== 'awaiting' || !sid) return undefined;
    const id = setInterval(() => {
      void (async () => {
        const result = await getPairingStatus(sid);
        if (!result.success) return;
        if (result.data.qr) setQr((prev) => (result.data.qr !== prev ? result.data.qr : prev));
        if (result.data.status === 'connected') {
          setPhase('connected');
          toast.success('Número WhatsApp pareado com sucesso');
          router.refresh();
          onConnected();
        } else if (result.data.status === 'disconnected') {
          setErrorMsg('A sessão caiu antes de parear. Tente de novo.');
          setPhase('error');
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [phase, sid, router, onConnected]);

  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 py-2 text-center">
      {phase === 'starting' && <p className="text-sm text-muted-foreground">Iniciando sessão…</p>}

      {phase === 'awaiting' && (
        <>
          {qr ? (
            qr.startsWith('data:image') ? (
              <Image
                src={qr}
                alt="QR Code de pareamento"
                width={240}
                height={240}
                unoptimized
                className="rounded-md border bg-white p-2"
              />
            ) : (
              <pre className="max-w-full overflow-auto rounded-md border bg-[var(--muted)] p-3 text-left text-xs">
                {qr}
              </pre>
            )
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
