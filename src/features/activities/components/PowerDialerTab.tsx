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
  notesRevisionForSubmit,
  onWebphoneConcludeRequested,
  releaseWebphoneCallOwner,
  setWebphoneCallContext,
} from '@/features/integrations/webphone/webphone-call-context';
import { cancelWebphoneDial, publishWebphoneDial, reserveWebphoneDial } from '@/features/integrations/webphone/webphone-dial-correlation';
import {
  getWebphoneState,
  hangupCall as hangupWebphoneLeg,
  prepareWebphoneMicForDial,
} from '@/features/integrations/webphone/webphone-client';
import {
  canReceiveCalls,
  dialingBlockReason,
  webphoneUsableAfterMicGesture,
} from '@/features/integrations/webphone/webphone-state';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';
import type { DialerPreferences, DialerStats } from '../schemas/dialer-preferences.schemas';
import { completeDialerCall } from '../actions/complete-dialer-call';
import { hasWrittenNotes } from '../types/call-attempt';
import {
  AUTO_DIAL_ANSWER_TIMEOUT_MS,
  availablePhones,
  buildAttemptLog,
  decideAfterNoAnswer,
  initialAutoDialState,
  isAutoDialEligible,
  itemPhones,
  loadAutoDialPreference,
  phoneKey,
  pickNextAutoDial,
  recordAttempt,
  reduceAutoDial,
  saveAutoDialPreference,
  type AutoDialEvent,
  type AutoDialPick,
  type PhoneAttempt,
} from '../utils/auto-dialer';
import {
  LOCAL_SESSION_GRACE_MS,
  nextRamalAttempt,
  RAMAL_BUSY_PAUSE_MESSAGE,
  sessionOfThisDial,
  SESSION_MISSING_MESSAGE,
} from '../utils/power-dialer-webphone-sync';

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
  /** Flag `call_lead_card_v1`. Liga o cartão no painel direito. */
  leadCardEnabled?: boolean;
}

type DialResult =
  | { ok: true; joined: boolean; ended: boolean }
  | { ok: false; error: string | null; busy?: boolean };
/** `wait`: no automático, o próximo lead só fica liberado nesse horário (ms). */
type CompleteResult = { ok: true; wait?: number } | { ok: false; error: string | null };

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function PowerDialerTab({ initialQueue, stats: initialStats, preferences: initialPreferences, dialerProvider = 'api4com', leadCardEnabled = false }: PowerDialerTabProps) {
  const [queue] = useState<DialerQueueItem[]>(initialQueue);
  const [currentPreferences] = useState<DialerPreferences>(initialPreferences);
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
  const [dialToken, setDialToken] = useState<string | null>(null);
  const dialTokenRef = useRef<string | null>(null);
  const confirmedRef = useRef(false);
  const sessionEndedAtRef = useRef<number | null>(null);
  const ramalRetryUsedRef = useRef(false);
  const sessionMissedRef = useRef(false);

  // Discagem automática (story power-dialer-auto-dial).
  const webphone = useApi4ComWebphone();
  // Microfone ainda não pedido conta como pronto para a chave do automático:
  // o clique em iniciar (ou em Ligar) pede o microfone no mesmo gesto.
  const webphoneUsable = webphoneUsableAfterMicGesture(webphone);
  const [autoEnabled, setAutoEnabled] = useState(() => loadAutoDialPreference(browserStorage()));
  const [auto, dispatchAuto] = useReducer(reduceAutoDial, initialAutoDialState);
  const autoOn = auto.phase !== 'off';
  // Tentativas de hoje por número (story power-dialer-rounds): começa com a
  // contagem do servidor e soma cada discagem feita nesta tela.
  const [attemptLog, setAttemptLog] = useState<Map<string, PhoneAttempt>>(() => buildAttemptLog(initialQueue));
  const dailyLimit = currentPreferences.daily_limit_per_lead;

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

  /** Próximo lead do automático depois de `fromIndex` (dá a volta na fila). */
  function pickAuto(fromIndex: number, statuses: Map<string, DialerItemStatus>): AutoDialPick {
    return pickNextAutoDial(queue, fromIndex, new Set(statuses.keys()), attemptLog, dailyLimit, Date.now());
  }

  /** Vai para o lead escolhido e devolve o evento do automático (null = acabou). */
  function applyPick(pick: AutoDialPick): AutoDialEvent | null {
    if (pick.kind === 'none') return null;
    setCurrentIndex(pick.index);
    return pick.kind === 'dial' ? { type: 'next_lead' } : { type: 'wait', until: pick.until };
  }

  function finishAuto() {
    dispatchAuto({ type: 'stop' });
    toast.success('Discagem automática concluída: não há mais tentativas para hoje.');
  }

  function resetCallState() {
    if (callId) clearWebphoneCallContext(callId);
    if (dialTokenRef.current) cancelWebphoneDial(dialTokenRef.current);
    rememberDialToken(null);
    confirmedRef.current = false;
    sessionMissedRef.current = false;
    setCallState('idle');
    setCallId(null);
    setProviderCallId(null);
  }

  function rememberDialToken(token: string | null) {
    dialTokenRef.current = token;
    setDialToken(token);
  }

  function attemptIsOpen() {
    return callState === 'calling' || callState === 'awaiting-session' || callState === 'connected';
  }

  const isInCall = callState === 'calling' || callState === 'connected';
  const localRelation = sessionOfThisDial(webphone.call, dialToken);
  // O lead atendeu? (webhook da API4COM; "unknown" até ele chegar.)
  // Atender o ramal não é atender o lead: este sinal só vale depois do fim.
  const leadAnswer = useWebphoneLeadAnswer(callState === 'ended' ? callId : null);

  const handleRemoteHangup = useCallback((_durationSeconds: number) => {
    const relation = sessionOfThisDial(getWebphoneState().call, dialTokenRef.current);
    // O servidor encerrou antes do BYE: a sessão desta aba continua mandando.
    if (relation === 'live') return;
    if (!confirmedRef.current) {
      sessionMissedRef.current = true;
      if (dialTokenRef.current) cancelWebphoneDial(dialTokenRef.current);
      setCallState('idle');
      dispatchAuto({ type: 'session_missing', message: SESSION_MISSING_MESSAGE });
      return;
    }
    sessionEndedAtRef.current = Date.now();
    setCallState('ended');
  }, []);

  useCallHangupDetection({
    callId,
    isActive: isInCall || callState === 'awaiting-session',
    onHangup: handleRemoteHangup,
  });

  // Só a sessão com o token deste clique muda a tela. Sessão antiga não encerra
  // nem confirma a discagem nova, mesmo que o POST já tenha voltado.
  useEffect(() => {
    if (localRelation === 'live' && (callState === 'awaiting-session' || callState === 'calling')) {
      confirmedRef.current = true;
      sessionMissedRef.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- espelha a sessão SIP desta aba
      setCallState('connected');
      dispatchAuto({ type: 'session_confirmed' });
      return;
    }
    if (localRelation === 'ended' && (callState === 'connected' || callState === 'calling' || callState === 'awaiting-session')) {
      confirmedRef.current = true;
      sessionEndedAtRef.current = Date.now();
      setCallState('ended');
      dispatchAuto({ type: 'session_confirmed' });
    }
  }, [localRelation, callState]);

  useEffect(() => {
    if (callState !== 'awaiting-session' || sessionMissedRef.current) return;
    if (localRelation !== 'none') return;
    const tokenAtStart = dialTokenRef.current;
    const timer = window.setTimeout(() => {
      if (dialTokenRef.current !== tokenAtStart || sessionMissedRef.current) return;
      const later = sessionOfThisDial(getWebphoneState().call, tokenAtStart);
      if (later === 'live') {
        confirmedRef.current = true;
        setCallState('connected');
        dispatchAuto({ type: 'session_confirmed' });
        return;
      }
      if (later === 'ended') {
        confirmedRef.current = true;
        sessionEndedAtRef.current = Date.now();
        setCallState('ended');
        dispatchAuto({ type: 'session_confirmed' });
        return;
      }
      sessionMissedRef.current = true;
      if (tokenAtStart) cancelWebphoneDial(tokenAtStart);
      dispatchAuto({ type: 'session_missing', message: SESSION_MISSING_MESSAGE });
    }, LOCAL_SESSION_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [callState, localRelation]);

  // "Concluir" no painel flutuante do webphone → este painel vai para o
  // resultado sem esperar o webhook. Ao desmontar no meio da ligação, o
  // painel flutuante assume o resultado.
  useEffect(() => {
    if (!callId) return;
    return onWebphoneConcludeRequested((detail) => {
      if (detail.callId !== callId) return;
      // O SDR concluiu no painel flutuante. Não é o webhook e não é a rotação.
      confirmedRef.current = true;
      sessionEndedAtRef.current = Date.now();
      setCallState('ended');
    });
  }, [callId]);
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

  async function dial(phone?: string): Promise<DialResult> {
    const item = currentItem;
    const phoneToCall = phone ?? item?.phone;
    if (!phoneToCall || inFlightRef.current) return { ok: false, error: null };
    if (callState === 'calling' || callState === 'connected' || callState === 'awaiting-session') {
      return { ok: false, error: 'Já existe uma ligação em andamento nesta aba.' };
    }
    // Microfone ainda não pedido: pede no mesmo clique, antes de armar a trava.
    // Sem nada a pedir o caminho segue síncrono (sem await).
    const pendingMic = prepareWebphoneMicForDial();
    if (pendingMic) {
      const micBlock = await pendingMic;
      if (micBlock) {
        toast.error(micBlock, { duration: 6000 });
        return { ok: false, error: micBlock };
      }
      if (inFlightRef.current) return { ok: false, error: null };
    }
    const blocked = dialingBlockReason(getWebphoneState());
    if (blocked) {
      toast.error(blocked, { duration: 6000 });
      return { ok: false, error: blocked };
    }
    inFlightRef.current = true;
    sessionMissedRef.current = false;
    confirmedRef.current = false;
    const reserved = reserveWebphoneDial(phoneToCall);
    rememberDialToken(reserved.token);

    return new Promise<DialResult>((resolve) => {
      startTransition(async () => {
        setCallState('calling');

        let result: Awaited<ReturnType<typeof initiateCall>>;
        try {
          result = await initiateCall({
            provider: dialerProvider,
            phone: phoneToCall,
            leadId: item?.leadId ?? '',
          });
        } catch {
          // Não se sabe se a operadora criou a chamada. Não repetir daqui.
          cancelWebphoneDial(reserved.token);
          setCallState('idle');
          inFlightRef.current = false;
          resolve({ ok: false, error: 'Não sei se a operadora criou a ligação. A discagem parou para não repetir o pedido.' });
          return;
        }

        if (!result.success) {
          cancelWebphoneDial(reserved.token);
          inFlightRef.current = false;
          if (result.code === 'ramal_busy') {
            setCallState('releasing');
            resolve({ ok: false, error: result.error, busy: true });
            return;
          }
          const looksLikeNoPhone = result.error?.includes('ramal') || result.error?.includes('offline') || result.error?.includes('not registered') || result.error?.includes('503');
          if (looksLikeNoPhone && !canReceiveCalls(getWebphoneState())) {
            toast.error('Abra a extensão API4COM (webphone) antes de ligar', { duration: 5000 });
          } else {
            toast.error(result.error);
          }
          setCallState('idle');
          resolve({ ok: false, error: result.error ?? null });
          return;
        }

        setAttemptLog((prev) => recordAttempt(prev, phoneToCall, Date.now()));
        setCallId(result.data.callId);
        setProviderCallId(result.data.providerCallId);
        inFlightRef.current = false;
        ramalRetryUsedRef.current = false;

        publishWebphoneDial(reserved.seq, () =>
          setWebphoneCallContext({
            callId: result.data.callId,
            providerCallId: result.data.providerCallId,
            leadId: item?.leadId ?? null,
            leadName: item?.leadName ?? null,
            phone: phoneToCall,
            ownerHandlesResult: true,
            dialToken: reserved.token,
          }),
        );

        const relation = sessionOfThisDial(getWebphoneState().call, reserved.token);
        if (relation === 'live') {
          confirmedRef.current = true;
          setCallState('connected');
          resolve({ ok: true, joined: true, ended: false });
          return;
        }
        if (relation === 'ended') {
          confirmedRef.current = true;
          sessionEndedAtRef.current = Date.now();
          setCallState('ended');
          resolve({ ok: true, joined: true, ended: true });
          return;
        }
        setCallState('awaiting-session');
        resolve({ ok: true, joined: false, ended: false });
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
    /** Atendida no automático: a IA classifica a gravação depois. */
    aiOutcomePending?: boolean;
  }): Promise<CompleteResult> {
    const item = currentItem;
    if (!item) return Promise.resolve({ ok: false, error: null });
    const autoMode = autoOn;

    return new Promise<CompleteResult>((resolve) => {
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
          notesRev: callId && args.notes.trim() ? notesRevisionForSubmit(callId, args.notes) : undefined,
          sdrOutcome: args.sdrOutcome,
          aiOutcomePending: args.aiOutcomePending,
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

        if (autoMode) {
          const pick = pickAuto(currentIndex, newStatuses);
          if (pick.kind === 'none') {
            finishAuto();
            resolve({ ok: true });
            return;
          }
          setCurrentIndex(pick.index);
          resolve(pick.kind === 'wait' ? { ok: true, wait: pick.until } : { ok: true });
          return;
        }
        const next = findNextPending(currentIndex, newStatuses);
        if (next >= 0) {
          setCurrentIndex(next);
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

  /** Números do lead da vez que podem ser discados agora. */
  function dialablePhones(): string[] {
    if (!currentItem || !isAutoDialEligible(currentItem, doneIds)) return [];
    return availablePhones(currentItem, attemptLog, dailyLimit, Date.now());
  }

  /**
   * Aponta para um lead com número liberado (o atual, se puder). Devolve o
   * evento a seguir (`wait` quando todos estão no intervalo) ou null se acabou.
   */
  function alignAuto(): AutoDialEvent | null {
    if (dialablePhones().length > 0) return { type: 'next_lead' };
    return applyPick(pickAuto(currentIndex - 1, itemStatuses));
  }

  function startAuto() {
    // Estado atual (não o da renderização): quem chama acabou de resolver o
    // microfone no clique.
    if (!canReceiveCalls(getWebphoneState())) return;
    const ev = alignAuto();
    if (!ev) {
      toast.info('Nenhum lead na etapa de ligação com tentativas para hoje.');
      return;
    }
    dispatchAuto({ type: 'start' });
    if (ev.type === 'wait') dispatchAuto(ev);
  }

  function handleAutoToggle(enabled: boolean) {
    setAutoEnabled(enabled);
    saveAutoDialPreference(browserStorage(), enabled);
    if (!enabled) {
      dispatchAuto({ type: 'stop' });
      return;
    }
    if (isActive && callState === 'idle' && !autoOn) void startAutoWithMic();
  }

  /**
   * Clique que liga o automático: pede o microfone no mesmo gesto e só então
   * inicia. Com o microfone já resolvido inicia na hora (sem await). Devolve
   * false quando o microfone não foi concedido.
   */
  async function startAutoWithMic(): Promise<boolean> {
    const pendingMic = prepareWebphoneMicForDial();
    const micBlock = pendingMic ? await pendingMic : null;
    if (micBlock) {
      toast.error(micBlock, { duration: 6000 });
      return false;
    }
    startAuto();
    return true;
  }

  // Contagem regressiva: um tique por segundo.
  useEffect(() => {
    if (auto.phase !== 'countdown') return;
    const t = window.setTimeout(() => dispatchAuto({ type: 'tick' }), 1000);
    return () => window.clearTimeout(t);
  }, [auto]);

  // Zerou a contagem (ou "Ligar agora"): disca o próximo número liberado do lead.
  const onAutoDial = useEffectEvent(() => {
    const phones = dialablePhones();
    if (phones.length === 0) {
      const ev = applyPick(pickAuto(currentIndex - 1, itemStatuses));
      if (ev) dispatchAuto(ev);
      else finishAuto();
      return;
    }
    const state = getWebphoneState();
    if (!canReceiveCalls(state)) {
      // Motivo específico ("Ative o microfone", "O ramal está em uso em outra
      // aba") quando houver; a frase genérica fica só de reserva.
      dispatchAuto({ type: 'pause', reason: 'blocked', message: dialingBlockReason(state) ?? 'o webphone não está pronto nesta aba' });
      return;
    }
    const blocked = dialingBlockReason(state);
    if (blocked) {
      dispatchAuto({ type: 'pause', reason: 'blocked', message: blocked });
      return;
    }
    void dial(phones[0]).then((r) => {
      if (!r.ok) {
        if (r.busy) {
          const decision = nextRamalAttempt({
            sessionEndedAt: sessionEndedAtRef.current,
            now: Date.now(),
            alreadyRetried: ramalRetryUsedRef.current,
          });
          if (decision.action === 'wait') {
            ramalRetryUsedRef.current = true;
            dispatchAuto({ type: 'ramal_busy', until: Date.now() + decision.waitMs });
            return;
          }
          dispatchAuto({ type: 'dial_failed', message: RAMAL_BUSY_PAUSE_MESSAGE });
          setCallState('idle');
          return;
        }
        dispatchAuto({ type: 'dial_failed', message: r.error });
        return;
      }
      if (r.joined) dispatchAuto({ type: 'dial_started' });
      else dispatchAuto({ type: 'awaiting_session' });
    });
  });
  useEffect(() => {
    if (auto.phase === 'dialing') onAutoDial();
  }, [auto.phase]);

  // 424 confirmado: uma espera até a folga do ramal e um único POST seguinte.
  useEffect(() => {
    if (auto.phase !== 'releasing') return;
    const delay = Math.max(auto.until - Date.now(), 0);
    const timer = window.setTimeout(() => dispatchAuto({ type: 'ramal_retry' }), delay);
    return () => window.clearTimeout(timer);
  }, [auto]);

  // A ligação acabou.
  useEffect(() => {
    if (auto.phase === 'in-call' && callState === 'ended') dispatchAuto({ type: 'call_ended' });
  }, [auto.phase, callState]);

  // Esperando o sinal da API4COM (atendeu ou não). Não atendeu: outro número
  // do lead, outro lead (volta mais tarde) ou última tentativa do dia.
  const onLeadAnswer = useEffectEvent((answer: 'answered' | 'not_answered') => {
    if (answer === 'answered' || !currentItem) {
      dispatchAuto({ type: 'lead_answer', answer });
      return;
    }
    const then = decideAfterNoAnswer(currentItem, attemptLog, dailyLimit, Date.now());
    if (then === 'next_number') resetCallState();
    dispatchAuto({ type: 'lead_answer', answer, then });
  });
  useEffect(() => {
    if (auto.phase !== 'resolving') return;
    if (leadAnswer !== 'unknown') {
      onLeadAnswer(leadAnswer);
      return;
    }
    const t = window.setTimeout(() => dispatchAuto({ type: 'answer_timeout' }), AUTO_DIAL_ANSWER_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [auto.phase, leadAnswer]);

  // Não atendeu, com tentativas mais tarde: vai para o próximo lead sem
  // concluir a tarefa (o lead volta quando o intervalo de 1 h passar).
  const onAutoAdvance = useEffectEvent(() => {
    resetCallState();
    const ev = applyPick(pickAuto(currentIndex, itemStatuses));
    if (ev) dispatchAuto(ev);
    else finishAuto();
  });
  useEffect(() => {
    if (auto.phase === 'advancing') onAutoAdvance();
  }, [auto.phase]);

  // Todos em espera: acorda quando o primeiro número fica liberado.
  useEffect(() => {
    if (auto.phase !== 'waiting') return;
    const delay = Math.min(Math.max(auto.until - Date.now(), 0) + 1000, 2 ** 31 - 1);
    const t = window.setTimeout(() => dispatchAuto({ type: 'wake' }), delay);
    return () => window.clearTimeout(t);
  }, [auto]);

  // Registra sozinho (com as anotações do painel flutuante) e segue:
  // atendida → a IA classifica a gravação depois; não atendida (última
  // tentativa do dia) → "Não atendeu".
  const onAutoComplete = useEffectEvent((outcome: 'answered' | 'no_answer') => {
    const notes = getWebphoneCallContextState().notes;
    const args =
      outcome === 'answered'
        ? { notes, durationSeconds: 0, aiOutcomePending: true }
        : { notes, durationSeconds: 0, sdrOutcome: 'no_answer' as const };
    void completeCurrent(args).then((r) => {
      if (!r.ok) {
        dispatchAuto({ type: 'complete_failed', message: r.error });
        return;
      }
      dispatchAuto({ type: 'completed' });
      if (r.wait !== undefined) dispatchAuto({ type: 'wait', until: r.wait });
    });
  });
  const autoCompleteOutcome = auto.phase === 'auto-completing' ? auto.outcome : null;
  useEffect(() => {
    if (autoCompleteOutcome) onAutoComplete(autoCompleteOutcome);
  }, [autoCompleteOutcome]);

  // -------------------------------------------------------------------------
  // Ações da tela
  // -------------------------------------------------------------------------

  async function handleStart() {
    setIsActive(true);
    // Microfone negado no clique: não inicia o automático e segue no manual.
    if (autoEnabled && webphoneUsable && (await startAutoWithMic())) return;
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
    if (attemptIsOpen()) {
      toast.error('Encerre a tentativa desta aba antes de pular.');
      return;
    }
    const newStatuses = new Map(itemStatuses);
    newStatuses.set(currentItem.enrollmentId, 'skipped');
    setItemStatuses(newStatuses);
    resetCallState();

    if (autoOn) {
      const ev = applyPick(pickAuto(currentIndex, newStatuses));
      if (ev) dispatchAuto(ev);
      else finishAuto();
      return;
    }
    const next = findNextPending(currentIndex, newStatuses);
    if (next >= 0) {
      setCurrentIndex(next);
    } else {
      setIsActive(false);
      toast.info('Fila de ligacoes concluida!');
    }
  }

  function handleRetry() {
    resetCallState();
  }

  function handleHangup() {
    const call = getWebphoneState().call;
    const token = dialTokenRef.current;
    const ours = sessionOfThisDial(call, token) === 'live';
    if (ours) void hangupWebphoneLeg();
    else if (token) cancelWebphoneDial(token);

    if (!providerCallId) {
      if (!ours && !confirmedRef.current) setCallState('idle');
      return;
    }

    const providerId = providerCallId;
    const joined = confirmedRef.current || ours;
    startTransition(async () => {
      const result = await hangupCall(dialerProvider, providerId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      if (ours) return;
      if (!joined) {
        sessionMissedRef.current = true;
        rememberDialToken(null);
        setCallState('idle');
        dispatchAuto({ type: 'session_missing', message: SESSION_MISSING_MESSAGE });
        return;
      }
      // A sessão que está no ar não é a desta discagem. O fim pedido foi o desta
      // chamada no provedor; a outra sessão continua.
      sessionEndedAtRef.current = Date.now();
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
      if (!r.ok || !wasAwaitingSdr) return;
      dispatchAuto({ type: 'sdr_concluded' });
      if (r.wait !== undefined) dispatchAuto({ type: 'wait', until: r.wait });
    });
  }

  function handleSelectIndex(index: number) {
    if (attemptIsOpen()) {
      toast.error('Encerre a tentativa desta aba antes de trocar de lead.');
      return;
    }
    setCurrentIndex(index);
    resetCallState();
    if (!isActive) setIsActive(true);
    // Escolher um lead na lista = o SDR assumiu o controle.
    if (autoOn) dispatchAuto({ type: 'pause', reason: 'user' });
  }

  // "Número 1 de 2 · tentativa 2/3" do próximo número a discar.
  const nextPhone = auto.phase === 'countdown' ? dialablePhones()[0] : undefined;
  let attemptDetail: string | null = null;
  if (currentItem && nextPhone) {
    const all = itemPhones(currentItem);
    const pos = all.findIndex((p) => phoneKey(p) === phoneKey(nextPhone));
    const done = attemptLog.get(phoneKey(nextPhone))?.count ?? 0;
    attemptDetail = `${nextPhone} · número ${pos + 1} de ${all.length} · tentativa ${done + 1}/${dailyLimit}`;
  }

  // Idle state: show Meetime-style layout
  if (!isActive) {
    return (
      <PowerDialerIdleLayout
        queue={queue}
        stats={initialStats}
        preferences={currentPreferences}
        onStart={() => void handleStart()}
        dialerProvider={dialerProvider}
        autoDialToggle={
          dialerProvider === 'api4com' ? (
            <AutoDialToggle enabled={autoEnabled} available={webphoneUsable} onChange={handleAutoToggle} />
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
            <AutoDialToggle enabled={autoEnabled} available={webphoneUsable} onChange={handleAutoToggle} />
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
          detail={attemptDetail}
          canResume={callState === 'idle'}
          onPause={() => dispatchAuto({ type: 'pause', reason: 'user' })}
          onResume={async () => {
            // Clique: acorda o áudio e pede o microfone se ainda não foi pedido.
            const pendingMic = prepareWebphoneMicForDial();
            const micBlock = pendingMic ? await pendingMic : null;
            if (micBlock) {
              toast.error(micBlock, { duration: 6000 });
              return;
            }
            const ev = alignAuto();
            if (!ev) {
              finishAuto();
              return;
            }
            dispatchAuto({ type: 'resume' });
            if (ev.type === 'wait') dispatchAuto(ev);
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
                leadCardEnabled={leadCardEnabled}
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
