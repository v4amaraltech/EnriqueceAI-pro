'use client';

import { useEffect, useReducer, useRef, useState, useTransition } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';

import type { ResolvedPhone } from '@/features/activities/utils/resolve-whatsapp-phone';

import { endWhatsAppCall, startWhatsAppCall } from '../actions/calls';
import { persistWhatsAppCall } from '../actions/persist-call';
import { RECORDING_CONSENT_NOTICE } from '../constants';
import { INITIAL_CALL_STATE, callReducer } from '../call-machine';
import { acquireMic, releaseMic } from '../voice-call-media';
import { CallDispositionForm } from './CallDispositionForm';

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
  // Metadados da chamada para persistir ao encerrar (story 7.7).
  const callStartedAtRef = useRef<string | null>(null);
  const answeredAtRef = useRef<string | null>(null);
  const durationRef = useRef<number>(0);
  // URL da gravação (story 7.8) — preenchida pela perna de mídia do 7.1 ao
  // encerrar (TODO em voice-call-media). Hoje fica null no shell.
  const recordingUrlRef = useRef<string | null>(null);

  // Cronômetro só na conexão real (status active).
  useEffect(() => {
    if (state.status !== 'active') return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  // Solta o microfone ao desmontar.
  useEffect(() => () => releaseMic(micRef.current), []);

  const elapsed =
    state.status === 'active' ? Math.max(0, Math.floor((now - state.startedAt) / 1000)) : 0;

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
      const result = await startWhatsAppCall({ phone: selectedPhone });
      if (!result.success) {
        releaseMic(micRef.current);
        micRef.current = null;
        dispatch({ type: 'SERVICE_ERROR', message: result.error });
        return;
      }
      sidRef.current = result.data.sid;
      callIdRef.current = result.data.callId;
      callStartedAtRef.current = new Date().toISOString();
      dispatch({ type: 'CALL_STARTED' });
    });
  }

  // Stand-in temporário: até a perna SSE do 7.1, o atendimento é marcado à mão.
  function handleAnswered() {
    answeredAtRef.current = new Date().toISOString();
    setNow(Date.now());
    dispatch({ type: 'ANSWERED', at: Date.now() });
  }

  function handleHangup() {
    const sid = sidRef.current;
    const callId = callIdRef.current;
    durationRef.current =
      state.status === 'active' ? Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)) : 0;
    releaseMic(micRef.current);
    micRef.current = null;
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

  return (
    <div className="space-y-4 p-1">
      <div>
        <h3 className="text-sm font-semibold">{activityName || 'Ligação via WhatsApp'}</h3>
        <p className="text-xs text-muted-foreground">{leadName}</p>
      </div>

      <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">
        <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
        {RECORDING_CONSENT_NOTICE}
      </div>

      {callScript && (
        <div className="rounded-md border bg-[var(--muted)]/30 p-3 text-sm whitespace-pre-wrap">
          {callScript}
        </div>
      )}

      {(state.status === 'idle' || state.status === 'error') && (
        <div className="space-y-3">
          {phones.length > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="wa-call-phone" className="text-sm font-semibold">
                Número
              </Label>
              <select
                id="wa-call-phone"
                value={selectedPhone}
                onChange={(e) => setSelectedPhone(e.target.value)}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              >
                {phones.map((p) => (
                  <option key={p.raw} value={p.raw}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {phones[0]?.label ?? 'Nenhum número WhatsApp disponível'}
            </p>
          )}

          {state.status === 'error' && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}

          <Button onClick={handleDial} disabled={isPending || !selectedPhone} className="w-full gap-2">
            <Phone className="h-4 w-4" />
            {state.status === 'error' ? 'Tentar de novo' : 'Ligar via WhatsApp'}
          </Button>
        </div>
      )}

      {state.status === 'requesting-mic' && (
        <p className="text-center text-sm text-muted-foreground">Pedindo acesso ao microfone…</p>
      )}

      {state.status === 'ringing' && (
        <div className="space-y-3 text-center">
          <p className="text-sm font-medium">Chamando…</p>
          <p className="text-xs text-muted-foreground">
            O atendimento automático chega com o serviço de voz (em configuração).
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={handleAnswered}>
              Atendeu
            </Button>
            <Button variant="destructive" className="flex-1 gap-2" onClick={handleHangup}>
              <PhoneOff className="h-4 w-4" />
              Encerrar
            </Button>
          </div>
        </div>
      )}

      {state.status === 'active' && (
        <div className="space-y-3 text-center">
          <p className="text-2xl font-semibold tabular-nums">{formatElapsed(elapsed)}</p>
          <p className="text-xs text-muted-foreground">Em chamada com {leadName}</p>
          <Button variant="destructive" className="w-full gap-2" onClick={handleHangup}>
            <PhoneOff className="h-4 w-4" />
            Desligar
          </Button>
        </div>
      )}
    </div>
  );
}
