'use client';

import { useEffect, useReducer, useRef, useState, useTransition } from 'react';
import { PhoneOff, User } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';

import type { ResolvedPhone } from '@/features/activities/utils/resolve-whatsapp-phone';

import { endWhatsAppCall, startWhatsAppCall } from '../actions/calls';
import { persistWhatsAppCall } from '../actions/persist-call';
import { INITIAL_CALL_STATE, callReducer } from '../call-machine';
import { RECORDING_CONSENT_NOTICE } from '../constants';
import { acquireMic, openCall, releaseMic, subscribeCallEvents, type OpenCall } from '../voice-call-media';
import { CallDispositionForm } from './CallDispositionForm';
import { WhatsAppGlyph } from './WhatsAppGlyph';

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function ActivityWhatsAppCallPanel({
  enrollmentId,
  stepId,
  cadenceId,
  leadId,
  leadName,
  phones,
  activityName,
  callScript,
  onResolved,
}: {
  enrollmentId: string;
  stepId: string;
  cadenceId: string;
  leadId: string;
  leadName: string;
  phones: ResolvedPhone[];
  activityName: string | null;
  callScript: string | null;
  onResolved: () => void;
}) {
  const [state, dispatch] = useReducer(callReducer, INITIAL_CALL_STATE);
  const [selectedPhone, setSelectedPhone] = useState(phones[0]?.raw ?? '');
  const [now, setNow] = useState<number>(() => Date.now());
  const [isPending, startTransition] = useTransition();

  const sidRef = useRef<string | null>(null);
  const callIdRef = useRef<string | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const connRef = useRef<OpenCall | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Metadados da chamada para persistir ao encerrar (story 7.7).
  const callStartedAtRef = useRef<string | null>(null);
  const answeredAtRef = useRef<string | null>(null);
  const durationRef = useRef<number>(0);
  // O serviço (AstraCalls) não devolve URL de gravação pela API → null por ora.
  const recordingUrlRef = useRef<string | null>(null);

  const selected = phones.find((p) => p.raw === selectedPhone);
  const displayNumber = selected?.formatted ?? selectedPhone;

  // Cronômetro só na conexão real (status active).
  useEffect(() => {
    if (state.status !== 'active') return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  // Liga o áudio remoto no <audio> assim que o track chega.
  useEffect(() => {
    if (state.status !== 'ringing' && state.status !== 'active') return undefined;
    const id = setInterval(() => {
      const remote = connRef.current?.getRemoteStream();
      if (remote && audioRef.current && audioRef.current.srcObject !== remote) {
        audioRef.current.srcObject = remote;
        void audioRef.current.play().catch(() => {});
      }
    }, 300);
    return () => clearInterval(id);
  }, [state.status]);

  // Limpeza ao desmontar.
  useEffect(
    () => () => {
      unsubRef.current?.();
      connRef.current?.close();
      releaseMic(micRef.current);
    },
    [],
  );

  const elapsed =
    state.status === 'active' ? Math.max(0, Math.floor((now - state.startedAt) / 1000)) : 0;

  function teardown() {
    durationRef.current = answeredAtRef.current
      ? Math.max(0, Math.floor((Date.now() - Date.parse(answeredAtRef.current)) / 1000))
      : 0;
    unsubRef.current?.();
    unsubRef.current = null;
    connRef.current?.close();
    connRef.current = null;
    releaseMic(micRef.current);
    micRef.current = null;
  }

  function handleDial() {
    if (!selectedPhone) {
      toast.error('Selecione um número');
      return;
    }
    dispatch({ type: 'DIAL' });
    startTransition(async () => {
      try {
        micRef.current = await acquireMic();
      } catch {
        dispatch({ type: 'MIC_DENIED' });
        return;
      }

      const started = await startWhatsAppCall({ phone: selectedPhone });
      if (!started.success) {
        releaseMic(micRef.current);
        micRef.current = null;
        dispatch({ type: 'SERVICE_ERROR', message: started.error });
        return;
      }
      sidRef.current = started.data.sid;
      callIdRef.current = started.data.callId;
      callStartedAtRef.current = new Date().toISOString();

      try {
        connRef.current = await openCall({
          sid: started.data.sid,
          callId: started.data.callId,
          micStream: micRef.current,
        });
      } catch {
        teardown();
        dispatch({ type: 'SERVICE_ERROR', message: 'Falha ao estabelecer o áudio (WebRTC).' });
        return;
      }

      // Lifecycle via SSE: o atendimento e o encerramento agora são automáticos.
      unsubRef.current = subscribeCallEvents(started.data.callId, {
        onConnected: () => {
          if (!answeredAtRef.current) answeredAtRef.current = new Date().toISOString();
          setNow(Date.now());
          dispatch({ type: 'ANSWERED', at: Date.now() });
        },
        onEnded: () => {
          teardown();
          dispatch({ type: 'HANGUP' });
        },
      });

      dispatch({ type: 'CALL_STARTED' });
    });
  }

  function handleHangup() {
    const sid = sidRef.current;
    const callId = callIdRef.current;
    teardown();
    dispatch({ type: 'HANGUP' });
    if (sid && callId) {
      startTransition(async () => {
        await endWhatsAppCall({ sid, callId });
      });
    }
  }

  // Encerrada → captura de disposition (story 7.6) que avança/reagenda a cadência.
  if (state.status === 'ended') {
    return (
      <div className="space-y-4 p-1">
        <p className="text-sm text-muted-foreground">Ligação encerrada com {leadName}.</p>
        <CallDispositionForm
          enrollmentId={enrollmentId}
          stepId={stepId}
          onPersist={(disposition) =>
            persistWhatsAppCall({
              stepId,
              cadenceId,
              leadId,
              sid: sidRef.current ?? '',
              callId: callIdRef.current ?? '',
              destination: selectedPhone,
              disposition,
              connected: !!answeredAtRef.current,
              durationSeconds: durationRef.current,
              startedAt: callStartedAtRef.current ?? new Date().toISOString(),
              answeredAt: answeredAtRef.current,
              recordingUrl: recordingUrlRef.current,
            }).then((r) => r.success)
          }
          onDone={() => onResolved()}
        />
      </div>
    );
  }

  const dialing = state.status === 'ringing' || state.status === 'active';

  return (
    <div className="space-y-4 p-1">
      {/* Áudio remoto (oculto) */}
      <audio ref={audioRef} autoPlay className="hidden" />

      <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">
        <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
        {RECORDING_CONSENT_NOTICE}
      </div>

      {/* Origem → Destino (estilo discador) */}
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-[var(--muted)]/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--muted)] text-muted-foreground">
            <User className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Origem</p>
            <p className="text-sm font-medium">Sua linha WhatsApp</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-right">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Destino</p>
            <p className="max-w-[160px] truncate text-sm font-medium">{leadName}</p>
          </div>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
            <WhatsAppGlyph className="h-5 w-5" />
          </span>
        </div>
      </div>

      {/* Seletor de telefone */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Selecionar telefone
        </p>
        <select
          value={selectedPhone}
          onChange={(e) => setSelectedPhone(e.target.value)}
          disabled={dialing || isPending}
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm disabled:opacity-60"
        >
          {phones.length === 0 ? (
            <option value="">Nenhum número WhatsApp disponível</option>
          ) : (
            phones.map((p) => (
              <option key={p.raw} value={p.raw}>
                {p.label}
              </option>
            ))
          )}
        </select>
      </div>

      {callScript && (
        <div className="rounded-md border bg-[var(--muted)]/30 p-3 text-sm whitespace-pre-wrap">
          {callScript}
        </div>
      )}

      {/* Área central — número em destaque + ação */}
      <div className="flex flex-col items-center justify-center gap-4 py-4 text-center">
        <p className="text-3xl font-semibold tabular-nums tracking-tight">{displayNumber || '—'}</p>

        {(state.status === 'idle' || state.status === 'error') && (
          <>
            <button
              type="button"
              aria-label="Ligar via WhatsApp"
              onClick={handleDial}
              disabled={isPending || !selectedPhone}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <WhatsAppGlyph className="h-8 w-8" />
            </button>
            <p className="text-sm text-muted-foreground">
              {state.status === 'error' ? 'Tentar de novo' : 'Clique para ligar via WhatsApp'}
            </p>
            {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
          </>
        )}

        {state.status === 'requesting-mic' && (
          <p className="text-sm text-muted-foreground">Pedindo acesso ao microfone…</p>
        )}

        {state.status === 'ringing' && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Chamando…</p>
            <p className="text-xs text-muted-foreground">Aguardando o lead atender.</p>
            <Button variant="destructive" className="gap-2" onClick={handleHangup}>
              <PhoneOff className="h-4 w-4" />
              Encerrar
            </Button>
          </div>
        )}

        {state.status === 'active' && (
          <div className="space-y-3">
            <p className="text-2xl font-semibold tabular-nums">{formatElapsed(elapsed)}</p>
            <p className="text-xs text-muted-foreground">Em chamada com {leadName}</p>
            <Button variant="destructive" className="gap-2" onClick={handleHangup}>
              <PhoneOff className="h-4 w-4" />
              Desligar
            </Button>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        {activityName || 'Ligação via WhatsApp'}
      </p>
    </div>
  );
}
