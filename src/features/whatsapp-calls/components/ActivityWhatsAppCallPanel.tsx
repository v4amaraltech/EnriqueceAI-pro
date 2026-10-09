'use client';

import { useEffect, useReducer, useRef, useState, useTransition } from 'react';
import { PhoneOff, User } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';

import type { ActionResult } from '@/lib/actions/action-result';

import type { CallDisposition } from '@/features/calls/types';
import type { ResolvedPhone } from '@/features/activities/utils/resolve-whatsapp-phone';

import { scheduleActivity } from '@/features/activities/actions/schedule-activity';
import { CallResultModal } from '@/features/activities/components/CallResultModal';

import { mapDispositionToAction } from '@/features/calls/disposition';
import { formatResumeDate } from '@/features/activities/utils/callback-resume';

import { applyCallDisposition } from '../actions/apply-call-disposition';
import { endWhatsAppCall, startWhatsAppCall } from '../actions/calls';
import { persistWhatsAppCall } from '../actions/persist-call';
import { INITIAL_CALL_STATE, callReducer } from '../call-machine';
import { RECORDING_CONSENT_NOTICE } from '../constants';
import { startRingback, type Ringback } from '../ringback';
import { acquireMic, openCall, releaseMic, subscribeCallEvents, type OpenCall } from '../voice-call-media';
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
  leadEmail,
  leadFirstName,
  phones,
  activityName,
  callScript,
  onResolved,
  onLeadLost,
}: {
  // Contexto de cadência (fila de atividades). Ausente numa ligação avulsa
  // disparada da tela do lead — aí o painel só registra a ligação, sem avançar
  // nenhuma atividade.
  enrollmentId?: string;
  stepId?: string;
  cadenceId?: string;
  leadId: string;
  leadName: string;
  leadEmail?: string | null;
  leadFirstName?: string | null;
  phones: ResolvedPhone[];
  activityName: string | null;
  callScript: string | null;
  onResolved: () => void;
  onLeadLost?: () => void;
}) {
  const [state, dispatch] = useReducer(callReducer, INITIAL_CALL_STATE);
  const [selectedPhone, setSelectedPhone] = useState(phones[0]?.raw ?? '');
  const [now, setNow] = useState<number>(() => Date.now());
  const [isPending, startTransition] = useTransition();
  // Duração final em state (não ref) para o render do modal de resultado —
  // ler durationRef.current durante o render viola react-hooks/refs.
  const [endedDuration, setEndedDuration] = useState(0);
  // Se a chamada chegou a ser atendida — alimenta o resumo e a pré-seleção do
  // desfecho no modal de resultado.
  const [wasAnswered, setWasAnswered] = useState(false);

  const sidRef = useRef<string | null>(null);
  const callIdRef = useRef<string | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const connRef = useRef<OpenCall | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ringbackRef = useRef<Ringback | null>(null);
  // Metadados da chamada para persistir ao encerrar (story 7.7).
  const callStartedAtRef = useRef<string | null>(null);
  const answeredAtRef = useRef<string | null>(null);
  const durationRef = useRef<number>(0);
  // O serviço (AstraCalls) não devolve URL de gravação pela API → null por ora.
  const recordingUrlRef = useRef<string | null>(null);
  // Serializa as gravações de UMA tentativa: a base (encerramento) roda antes do
  // enrich (Concluir/retry) — senão o enrich poderia inserir uma 2ª linha antes
  // do INSERT-base terminar. Resetada a cada nova discagem.
  const persistChainRef = useRef<Promise<unknown>>(Promise.resolve());

  const selected = phones.find((p) => p.raw === selectedPhone);
  const displayNumber = selected?.formatted ?? selectedPhone;

  // Cronômetro só na conexão real (status active).
  useEffect(() => {
    if (state.status !== 'active') return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  // Tom de chamada local enquanto aguarda o lead atender. O WhatsApp NÃO envia
  // ringback pela perna WebRTC (as trilhas remotas chegam `muted` até alguém
  // atender), então sem isso o SDR fica em silêncio absoluto no "Chamando..." —
  // sem saber se está tocando, travou ou caiu. Para sozinho ao sair de
  // 'ringing' (atendeu, encerrou ou deu erro) e no unmount.
  useEffect(() => {
    if (state.status !== 'ringing') return undefined;
    const rb = startRingback();
    ringbackRef.current = rb;
    return () => {
      rb.stop();
      ringbackRef.current = null;
    };
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
    // Corta o tom na hora — esperar o re-render do efeito deixaria o toque
    // sobrando por um instante depois de desligar.
    ringbackRef.current?.stop();
    ringbackRef.current = null;
    durationRef.current = answeredAtRef.current
      ? Math.max(0, Math.floor((Date.now() - Date.parse(answeredAtRef.current)) / 1000))
      : 0;
    setEndedDuration(durationRef.current);
    // Espelha o atendimento em state: o modal de resultado precisa disso no
    // render (ler o ref direto ali seria valor não-reativo e potencialmente
    // defasado). Duração não serve como proxy — atender e desligar em menos de
    // 1s daria 0 e passaria por "não atendida".
    setWasAnswered(!!answeredAtRef.current);
    unsubRef.current?.();
    unsubRef.current = null;
    connRef.current?.close();
    connRef.current = null;
    releaseMic(micRef.current);
    micRef.current = null;
  }

  // Persiste a tentativa atual. Faz snapshot dos refs no momento da CHAMADA (não
  // no momento em que a cadeia executa) — senão um enrich adiado leria os refs já
  // sobrescritos pela próxima discagem. Idempotente no servidor por callId.
  function persistAttempt(extra?: {
    sdrOutcome?: CallDisposition;
    notes?: string;
  }): Promise<ActionResult<{ callId: string }> | undefined> {
    const callId = callIdRef.current;
    if (!callId) return Promise.resolve(undefined);
    const snapshot = {
      stepId,
      cadenceId,
      leadId,
      contactId: selected?.contactId ?? null,
      sid: sidRef.current ?? '',
      callId,
      destination: selectedPhone,
      connected: !!answeredAtRef.current,
      disposition: (answeredAtRef.current ? 'significant' : 'not_connected') as
        | 'significant'
        | 'not_connected',
      durationSeconds: durationRef.current,
      startedAt: callStartedAtRef.current ?? new Date().toISOString(),
      answeredAt: answeredAtRef.current,
      recordingUrl: recordingUrlRef.current,
      sdrOutcome: extra?.sdrOutcome,
      notes: extra?.notes,
    };
    const run = () => persistWhatsAppCall(snapshot);
    const next = persistChainRef.current.then(run, run);
    persistChainRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function handleDial() {
    if (!selectedPhone) {
      toast.error('Selecione um número');
      return;
    }
    setWasAnswered(false);
    // Zera o estado da tentativa anterior — sem isto, answeredAtRef/durationRef
    // vazariam de uma tentativa (ex.: atendida) para a próxima re-discagem e a
    // gravação por tentativa registraria o desfecho errado. callStartedAt/sid/
    // callId são sobrescritos logo abaixo pela nova chamada.
    answeredAtRef.current = null;
    durationRef.current = 0;
    recordingUrlRef.current = null;
    persistChainRef.current = Promise.resolve();
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
      } catch (err) {
        teardown();
        // A causa REAL vinha sendo descartada por um `catch` vazio, então toda
        // falha (serviço fora do ar, SDP recusado, sessão morta no WhatsApp)
        // aparecia como a mesma frase genérica — impossível diagnosticar em
        // produção. `openCall` já propaga a mensagem do serviço em `Error`.
        const detail = err instanceof Error ? err.message.trim() : '';
        console.error('[whatsapp-call] falha no handshake WebRTC', {
          callId: callIdRef.current,
          sid: sidRef.current,
          error: detail || err,
        });
        dispatch({
          type: 'SERVICE_ERROR',
          message: detail
            ? `Falha ao estabelecer o áudio: ${detail}`
            : 'Falha ao estabelecer o áudio (WebRTC).',
        });
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

  // Encerrada → modal de resultado compartilhado (anotações + agendar retorno +
  // Perdido / Agendar Reunião / Concluir). O "atendeu" vem do SSE; "Concluir"
  // avança a cadência, "Agendar retorno" cria a atividade de retorno e encerra.
  if (state.status === 'ended') {
    return (
      <CallResultModal
        open
        // Cancelar/ESC/clicar fora: registra a tentativa mesmo assim (sem desfecho
        // do SDR) — senão uma ligação não atendida que o SDR só dispensa some do
        // histórico e a métrica de tentativas fica furada.
        onClose={() => {
          void persistAttempt().catch(() => {});
          onResolved();
        }}
        leadName={leadName}
        leadId={leadId}
        leadEmail={leadEmail}
        leadFirstName={leadFirstName}
        phoneLabel={displayNumber}
        durationSeconds={endedDuration}
        connected={wasAnswered}
        isSending={isPending}
        onRetry={(notes) => {
          // Grava a tentativa (com as anotações já digitadas no modal) ANTES de
          // re-discar — senão a retentativa evaporaria do histórico. A próxima
          // discagem gera um callId novo → cada tentativa vira um registro distinto.
          void persistAttempt({ notes }).catch(() => {});
          dispatch({ type: 'RESET' });
          // Re-disca na hora — o SDR liga várias vezes até conectar sem sair do
          // fluxo. Cada discagem gera um callId novo (registro por tentativa).
          handleDial();
        }}
        onLeadLost={
          onLeadLost
            ? () => {
                // "Perdido" também encerra a tentativa — registra antes de sair.
                void persistAttempt().catch(() => {});
                onLeadLost();
              }
            : undefined
        }
        onConclude={({ notes, returnSchedule, outcome }) => {
          startTransition(async () => {
            // `status` da ligação = SINAL TÉCNICO (atendeu ou não). O que o SDR
            // informou vai separado em `sdrOutcome` — sobrescrever o status com
            // leitura subjetiva foi o que gerou a divergência de BI em mai/2026.
            // A linha da tentativa já nasceu no encerramento; aqui enriquecemos
            // (upsert) com o desfecho do SDR + anotação.
            const persisted = await persistAttempt({ sdrOutcome: outcome, notes });
            if (persisted && !persisted.success) {
              toast.error('Não foi possível registrar a ligação no histórico.');
            }

            if (returnSchedule) {
              const r = await scheduleActivity({
                leadId,
                channel: returnSchedule.channel,
                callProvider: returnSchedule.callProvider,
                scheduledAt: returnSchedule.scheduledAt,
                notes: notes || undefined,
                // Não encerra a cadência (evita o limbo): pausa até o dia útil
                // seguinte ao retorno e retoma sozinha. Ver schedule-activity.ts.
                pauseCadenceUntilReturn: true,
                executedStep:
                  enrollmentId && stepId && !enrollmentId.startsWith('scheduled:')
                    ? { enrollmentId, stepId }
                    : undefined,
              });
              if (!r.success) {
                toast.error(r.error);
                return;
              }
              toast.success(
                r.data.cadencePausedUntil
                  ? `Retorno agendado — cadência pausada até ${formatResumeDate(r.data.cadencePausedUntil)}`
                  : 'Retorno agendado',
              );
            } else if (enrollmentId && stepId) {
              // O desfecho do SDR comanda a cadência (antes era 'significant'
              // fixo, então até ligação não atendida avançava). Quando o desfecho
              // reagenda, o `returnSchedule` acima já cuidou — aqui só sobram os
              // que avançam ou os que devolvem a atividade para a fila.
              const r = await applyCallDisposition({ enrollmentId, stepId, disposition: outcome });
              if (!r.success) {
                toast.error(r.error);
                return;
              }
              toast.success(
                mapDispositionToAction(outcome) === 'none'
                  ? 'Ligação registrada — atividade segue na fila'
                  : 'Atividade concluída',
              );
            } else {
              // Ligação avulsa: nada de cadência para avançar — só registramos.
              toast.success('Ligação registrada');
            }
            onResolved();
          });
        }}
      />
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
