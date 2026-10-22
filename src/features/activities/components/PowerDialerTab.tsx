'use client';

import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState, useTransition } from 'react';

import { Pause, Phone, SkipForward } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

import type { CallDisposition } from '@/features/calls/types';
import type { DialerProvider } from '@/features/calls/types/dialer-provider';
import { initiateCall, hangupCall } from '@/features/calls/actions/initiate-call';
import { useCallHangupDetection } from '@/features/calls/hooks/use-call-hangup-detection';
import { useApi4ComWebphone } from '@/features/integrations/webphone/useApi4ComWebphone';
import { useWebphoneLeadAnswer } from '@/features/integrations/webphone/useWebphoneLeadAnswer';
import {
  clearWebphoneCallContext,
  getWebphoneCallContextState,
  onWebphoneConcludeRequested,
  releaseWebphoneCallOwner,
  setWebphoneCallContext,
} from '@/features/integrations/webphone/webphone-call-context';
import { getWebphoneState } from '@/features/integrations/webphone/webphone-client';
import { canReceiveCalls, dialingBlockReason } from '@/features/integrations/webphone/webphone-state';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';
import type { DialerPreferences, DialerStats } from '../schemas/dialer-preferences.schemas';
import { completeDialerCall } from '../actions/complete-dialer-call';
import { hasWrittenNotes } from '../types/call-attempt';
import {
  AUTO_DIAL_ANSWER_TIMEOUT_MS,
  findNextAutoDialIndex,
  initialAutoDialState,
  isAutoDialEligible,
  loadAutoDialPreference,
  reduceAutoDial,
  saveAutoDialPreference,
} from '../utils/auto-dialer';

import { AutoDialStatusBar, AutoDialToggle } from './AutoDialControls';
import { DialerCallPanel, type CallState } from './DialerCallPanel';
import { DialerProgressBar } from './DialerProgressBar';
import { DialerQueueList, type DialerItemStatus } from './DialerQueueList';
import { PowerDialerIdleLayout } from './PowerDialerIdleLayout';

interface PowerDialerTabProps {
  initialQueue: DialerQueueItem[];
  stats: DialerStats;
  preferences: DialerPreferences;
  dialerProvider?: DialerProvider;
}

type DialResult = { ok: true } | { ok: false; error: string | null };

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function PowerDialerTab({ initialQueue, stats: initialStats, preferences: initialPreferences, dialerProvider = 'api4com' }: PowerDialerTabProps) {
  const [queue] = useState<DialerQueueItem[]>(initialQueue);
  const [currentPreferences, setCurrentPreferences] = useState<DialerPreferences>(initialPreferences);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [itemStatuses, setItemStatuses] = useState<Map<string, DialerItemStatus>>(new Map());
  const [isPending, startTransition] = useTransition();
  // Synchronous guard against double-clicks (see ActivityPhonePanel.tsx).
  const inFlightRef = useRef(false);

  const [callState, setCallState] = useState<CallState>('idle');
  const [providerCallId, setProviderCallId] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  // Quando a discagem atual começou: separa a ligação do webphone desta
  // discagem de uma anterior que ainda aparece como "encerrada" por ~2,5 s.
  const [dialStartedAt, setDialStartedAt] = useState<number | null>(null);

  // Discagem automática (story power-dialer-auto-dial).
  const webphone = useApi4ComWebphone();
  const webphoneReady = canReceiveCalls(webphone);
  const [autoEnabled, setAutoEnabled] = useState(() => loadAutoDialPreference(browserStorage()));
  const [auto, dispatchAuto] = useReducer(reduceAutoDial, initialAutoDialState);
  const autoOn = auto.phase !== 'off';

  const completedCount = [...itemStatuses.values()].filter((s) => s === 'completed').length;
  const skippedCount = [...itemStatuses.values()].filter((s) => s === 'skipped').length;
  const doneIds = useMemo(() => new Set(itemStatuses.keys()), [itemStatuses]);

  const currentItem = queue[currentIndex];

  // Find next pending index from a given position
  const findNextPending = useCallback(
    (fromIndex: number, statuses: Map<string, DialerItemStatus>) => {
      for (let i = fromIndex + 1; i < queue.length; i++) {
        const item = queue[i];
        if (item && !statuses.has(item.enrollmentId)) return i;
      }
      return -1; // no more pending
    },
    [queue],
  );

  /** Próximo lead depois de `fromIndex`: no automático, só os elegíveis. */
  function nextIndexAfter(fromIndex: number, statuses: Map<string, DialerItemStatus>, autoMode: boolean): number {
    return autoMode ? findNextAutoDialIndex(queue, fromIndex, new Set(statuses.keys())) : findNextPending(fromIndex, statuses);
  }

  function resetCallState() {
    if (callId) clearWebphoneCallContext(callId);
    setCallState('idle');
    setCallId(null);
    setProviderCallId(null);
    setDialStartedAt(null);
  }

  const isInCall = callState === 'calling' || callState === 'connected';
  // O lead atendeu? (webhook da API4COM; "unknown" até ele chegar.)
  const leadAnswer = useWebphoneLeadAnswer(callState === 'ended' ? callId : null);

  const handleRemoteHangup = useCallback((_durationSeconds: number) => {
    setCallState('ended');
  }, []);

  useCallHangupDetection({
    callId,
    isActive: isInCall,
    onHangup: handleRemoteHangup,
  });

  // Fim da ligação pelo próprio navegador: o Realtime acima só dispara quando
  // a API4COM classifica a ligação como conectada — a não atendida continua
  // `not_connected` e ficava "em chamada" até o SDR clicar.
  const browserCall = webphone.call;
  const browserCallEnded =
    !!browserCall &&
    browserCall.integrated &&
    browserCall.phase === 'ended' &&
    dialStartedAt !== null &&
    browserCall.startedAt >= dialStartedAt;
  useEffect(() => {
    // Trava o fim: a ligação some do webphone ~2,5 s depois de encerrar.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- espelha um store externo (webphone)
    if (browserCallEnded && isInCall) setCallState('ended');
  }, [browserCallEnded, isInCall]);

  // "Concluir" no painel flutuante do webphone → este painel vai para o
  // resultado sem esperar o webhook. Ao desmontar no meio da ligação, o
  // painel flutuante assume o resultado.
  useEffect(() => {
    if (!callId) return;
    return onWebphoneConcludeRequested((detail) => {
      if (detail.callId === callId) handleRemoteHangup(detail.durationSeconds);
    });
  }, [callId, handleRemoteHangup]);
  const activeCallIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeCallIdRef.current = callState !== 'idle' ? callId : null;
  }, [callId, callState]);
  useEffect(
    () => () => {
      if (activeCallIdRef.current) releaseWebphoneCallOwner(activeCallIdRef.current);
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Discar e concluir (compartilhado entre o modo manual e o automático)
  // -------------------------------------------------------------------------

  function dial(phone?: string): Promise<DialResult> {
    const item = currentItem;
    const phoneToCall = phone ?? item?.phone;
    if (!phoneToCall || inFlightRef.current) return Promise.resolve({ ok: false, error: null });
    const blocked = dialingBlockReason(getWebphoneState());
    if (blocked) {
      toast.error(blocked, { duration: 6000 });
      return Promise.resolve({ ok: false, error: blocked });
    }
    inFlightRef.current = true;
    setDialStartedAt(Date.now());

    return new Promise<DialResult>((resolve) => {
      startTransition(async () => {
        setCallState('calling');

        const result = await initiateCall({
          provider: dialerProvider,
          phone: phoneToCall,
          leadId: item?.leadId ?? '',
        });

        if (!result.success) {
          const looksLikeNoPhone = result.error?.includes('ramal') || result.error?.includes('offline') || result.error?.includes('not registered') || result.error?.includes('503');
          if (looksLikeNoPhone && !canReceiveCalls(getWebphoneState())) {
            toast.error('Abra a extensão API4COM (webphone) antes de ligar', { duration: 5000 });
          } else {
            toast.error(result.error);
          }
          setCallState('idle');
          setDialStartedAt(null);
          inFlightRef.current = false;
          resolve({ ok: false, error: result.error ?? null });
          return;
        }

        setCallId(result.data.callId);
        setProviderCallId(result.data.providerCallId);
        // Se o navegador já viu o fim enquanto o POST /calls respondia, mantém.
        setCallState((prev) => (prev === 'ended' ? 'ended' : 'connected'));
        inFlightRef.current = false;

        setWebphoneCallContext({
          callId: result.data.callId,
          providerCallId: result.data.providerCallId,
          leadId: item?.leadId ?? null,
          leadName: item?.leadName ?? null,
          phone: phoneToCall,
          ownerHandlesResult: true,
        });
        resolve({ ok: true });
      });
    });
  }

  function handleInitiateCall(phone?: string) {
    void dial(phone);
  }

  function completeCurrent(args: {
    notes: string;
    durationSeconds: number;
    callStatus?: string;
    sdrOutcome?: CallDisposition;
  }): Promise<DialResult> {
    const item = currentItem;
    if (!item) return Promise.resolve({ ok: false, error: null });
    const autoMode = autoOn;

    return new Promise<DialResult>((resolve) => {
      startTransition(async () => {
        const result = await completeDialerCall({
          enrollmentId: item.enrollmentId,
          cadenceId: item.cadenceId,
          stepId: item.stepId,
          leadId: item.leadId,
          phone: item.phone ?? '',
          callStatus: args.callStatus,
          notes: args.notes,
          durationSeconds: args.durationSeconds,
          callId: callId ?? undefined,
          sdrOutcome: args.sdrOutcome,
        });

        if (!result.success) {
          toast.error(result.error);
          resolve({ ok: false, error: result.error });
          return;
        }

        const newStatuses = new Map(itemStatuses);
        newStatuses.set(item.enrollmentId, 'completed');
        setItemStatuses(newStatuses);
        resetCallState();

        const next = nextIndexAfter(currentIndex, newStatuses, autoMode);
        if (next >= 0) {
          setCurrentIndex(next);
        } else if (autoMode) {
          dispatchAuto({ type: 'stop' });
          toast.success('Discagem automática concluída: não há mais leads na etapa de ligação.');
        } else {
          setIsActive(false);
          toast.success('Todas as ligacoes foram concluidas!');
        }
        resolve({ ok: true });
      });
    });
  }

  // -------------------------------------------------------------------------
  // Laço da discagem automática
  // -------------------------------------------------------------------------

  /** Aponta para o primeiro lead elegível a partir do atual; false se não há. */
  function alignToEligible(): boolean {
    if (currentItem && isAutoDialEligible(currentItem, doneIds)) return true;
    const idx = findNextAutoDialIndex(queue, -1, doneIds);
    if (idx < 0) return false;
    setCurrentIndex(idx);
    return true;
  }

  function startAuto() {
    if (!webphoneReady) return;
    if (!alignToEligible()) {
      toast.info('Nenhum lead na etapa de ligação para discar automaticamente.');
      return;
    }
    dispatchAuto({ type: 'start' });
  }

  function handleAutoToggle(enabled: boolean) {
    setAutoEnabled(enabled);
    saveAutoDialPreference(browserStorage(), enabled);
    if (!enabled) {
      dispatchAuto({ type: 'stop' });
      return;
    }
    if (isActive && callState === 'idle' && !autoOn) startAuto();
  }

  // Contagem regressiva: um tique por segundo.
  useEffect(() => {
    if (auto.phase !== 'countdown') return;
    const t = window.setTimeout(() => dispatchAuto({ type: 'tick' }), 1000);
    return () => window.clearTimeout(t);
  }, [auto]);

  // Zerou a contagem (ou "Ligar agora"): disca o telefone principal.
  const onAutoDial = useEffectEvent(() => {
    if (!currentItem || !isAutoDialEligible(currentItem, doneIds)) {
      if (alignToEligible()) dispatchAuto({ type: 'next_lead' });
      else {
        dispatchAuto({ type: 'stop' });
        toast.success('Discagem automática concluída: não há mais leads na etapa de ligação.');
      }
      return;
    }
    const state = getWebphoneState();
    if (!canReceiveCalls(state)) {
      dispatchAuto({ type: 'pause', reason: 'blocked', message: 'o webphone não está pronto nesta aba' });
      return;
    }
    const blocked = dialingBlockReason(state);
    if (blocked) {
      dispatchAuto({ type: 'pause', reason: 'blocked', message: blocked });
      return;
    }
    void dial(currentItem.phone ?? undefined).then((r) =>
      dispatchAuto(r.ok ? { type: 'dial_started' } : { type: 'dial_failed', message: r.error }),
    );
  });
  useEffect(() => {
    if (auto.phase === 'dialing') onAutoDial();
  }, [auto.phase]);

  // A ligação acabou.
  useEffect(() => {
    if (auto.phase === 'in-call' && callState === 'ended') dispatchAuto({ type: 'call_ended' });
  }, [auto.phase, callState]);

  // Esperando o sinal da API4COM (atendeu ou não).
  useEffect(() => {
    if (auto.phase !== 'resolving') return;
    if (leadAnswer !== 'unknown') {
      dispatchAuto({ type: 'lead_answer', answer: leadAnswer });
      return;
    }
    const t = window.setTimeout(() => dispatchAuto({ type: 'answer_timeout' }), AUTO_DIAL_ANSWER_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [auto.phase, leadAnswer]);

  // Não atendeu: registra sozinho (com as anotações do painel flutuante) e segue.
  const onAutoComplete = useEffectEvent(() => {
    const notes = getWebphoneCallContextState().notes;
    void completeCurrent({ notes, durationSeconds: 0, sdrOutcome: 'no_answer' }).then((r) =>
      dispatchAuto(r.ok ? { type: 'completed' } : { type: 'complete_failed', message: r.error }),
    );
  });
  useEffect(() => {
    if (auto.phase === 'auto-completing') onAutoComplete();
  }, [auto.phase]);

  // -------------------------------------------------------------------------
  // Ações da tela
  // -------------------------------------------------------------------------

  function handleStart() {
    setIsActive(true);
    if (autoEnabled && webphoneReady) {
      startAuto();
      return;
    }
    // If current is already done, find next pending
    if (currentItem && itemStatuses.has(currentItem.enrollmentId)) {
      const next = findNextPending(currentIndex - 1, itemStatuses);
      if (next >= 0) setCurrentIndex(next);
    }
  }

  function handlePause() {
    dispatchAuto({ type: 'stop' });
    setIsActive(false);
  }

  function handleSkip() {
    if (!currentItem) return;
    const newStatuses = new Map(itemStatuses);
    newStatuses.set(currentItem.enrollmentId, 'skipped');
    setItemStatuses(newStatuses);
    resetCallState();

    const next = nextIndexAfter(currentIndex, newStatuses, autoOn);
    if (next >= 0) {
      setCurrentIndex(next);
      dispatchAuto({ type: 'next_lead' });
    } else if (autoOn) {
      dispatchAuto({ type: 'stop' });
      toast.info('Discagem automática concluída: não há mais leads na etapa de ligação.');
    } else {
      setIsActive(false);
      toast.info('Fila de ligacoes concluida!');
    }
  }

  function handleRetry() {
    resetCallState();
  }

  function handleHangup() {
    if (!providerCallId) {
      setCallState('ended');
      return;
    }

    startTransition(async () => {
      const result = await hangupCall(dialerProvider, providerCallId ?? undefined);
      if (!result.success) {
        toast.error(result.error);
      }
      setCallState('ended');
    });
  }

  function handleComplete(callStatus: string, notes: string, durationSeconds: number) {
    const wasAwaitingSdr = auto.phase === 'awaiting-sdr';
    // O painel flutuante não tem mais tela própria depois da ligação: o que o
    // SDR anotou nele durante a conversa entra quando o formulário daqui não tem
    // texto (ele sempre traz as marcações das tentativas, ex.: "[]").
    const panelNotes = getWebphoneCallContextState().notes.trim();
    void completeCurrent({
      callStatus,
      notes: !hasWrittenNotes(notes) && panelNotes ? `${notes} ${panelNotes}`.trim() : notes,
      durationSeconds,
      // Não atendida pela API4COM: o desfecho já é sabido.
      sdrOutcome: leadAnswer === 'not_answered' ? 'no_answer' : undefined,
    }).then((r) => {
      if (r.ok && wasAwaitingSdr) dispatchAuto({ type: 'sdr_concluded' });
    });
  }

  function handleSelectIndex(index: number) {
    setCurrentIndex(index);
    resetCallState();
    if (!isActive) setIsActive(true);
    // Escolher um lead na lista = o SDR assumiu o controle.
    if (autoOn) dispatchAuto({ type: 'pause', reason: 'user' });
  }

  // Idle state: show Meetime-style layout
  if (!isActive) {
    return (
      <PowerDialerIdleLayout
        queue={queue}
        stats={initialStats}
        preferences={currentPreferences}
        onStart={handleStart}
        onPreferencesSaved={setCurrentPreferences}
        dialerProvider={dialerProvider}
        autoDialToggle={
          dialerProvider === 'api4com' ? (
            <AutoDialToggle enabled={autoEnabled} available={webphoneReady} onChange={handleAutoToggle} />
          ) : null
        }
      />
    );
  }

  // Active state: existing call flow
  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <DialerProgressBar completed={completedCount} skipped={skippedCount} total={queue.length} />

      {/* Controls */}
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          <span className="text-sm font-medium">Fila de Discagem</span>
          <Badge variant="secondary" className="text-xs">{queue.length} leads</Badge>
        </div>
        <div className="flex items-center gap-4">
          {dialerProvider === 'api4com' && (
            <AutoDialToggle enabled={autoEnabled} available={webphoneReady} onChange={handleAutoToggle} />
          )}
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={handlePause} aria-label="Pausar">
                  <Pause className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Pausar</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={handleSkip} aria-label="Pular">
                  <SkipForward className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Pular</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {autoOn && (
        <AutoDialStatusBar
          state={auto}
          leadName={currentItem?.leadName ?? null}
          canResume={callState === 'idle'}
          onPause={() => dispatchAuto({ type: 'pause', reason: 'user' })}
          onResume={() => {
            if (alignToEligible()) dispatchAuto({ type: 'resume' });
            else dispatchAuto({ type: 'stop' });
          }}
          onDialNow={() => dispatchAuto({ type: 'dial_now' })}
          onSkip={handleSkip}
        />
      )}

      {/* Main content: queue + call panel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left: Queue list */}
        <div className="lg:col-span-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
            <h3 className="mb-3 text-sm font-semibold text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Fila ({queue.length - completedCount - skippedCount} restantes)
            </h3>
            <DialerQueueList
              items={queue}
              itemStatuses={itemStatuses}
              currentIndex={currentIndex}
              isActive={isActive}
              onSelect={handleSelectIndex}
            />
          </div>
        </div>

        {/* Right: Call panel */}
        <div className="lg:col-span-8">
          {currentItem ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
              <DialerCallPanel
                item={currentItem}
                isSending={isPending}
                callState={callState}
                leadAnswer={leadAnswer}
                manualDialHidden={autoOn && auto.phase !== 'paused' && auto.phase !== 'awaiting-sdr'}
                onComplete={handleComplete}
                onSkip={handleSkip}
                onInitiateCall={handleInitiateCall}
                onHangup={handleHangup}
                onRetry={handleRetry}
                dialerProvider={dialerProvider}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] p-12">
              <div className="text-center">
                <Phone className="mx-auto h-10 w-10 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                <p className="mt-3 text-sm font-medium">Selecione um lead na fila</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
