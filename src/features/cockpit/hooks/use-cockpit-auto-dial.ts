'use client';

import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react';

import { toast } from 'sonner';

import { useCallHangupDetection } from '@/features/calls/hooks/use-call-hangup-detection';
import type { CallDisposition } from '@/features/calls/types';
import { AUTO_DIAL_ANSWER_TIMEOUT_MS, AUTO_DIAL_COUNTDOWN_SECONDS } from '@/features/activities/utils/auto-dialer';
import {
  LOCAL_SESSION_GRACE_MS,
  RAMAL_BUSY_PAUSE_MESSAGE,
  SESSION_MISSING_MESSAGE,
  sessionOfThisDial,
} from '@/features/activities/utils/power-dialer-webphone-sync';
import { useApi4ComWebphone } from '@/features/integrations/webphone/useApi4ComWebphone';
import { useWebphoneLeadAnswer } from '@/features/integrations/webphone/useWebphoneLeadAnswer';
import { setWebphoneCallContext } from '@/features/integrations/webphone/webphone-call-context';
import { cancelWebphoneDial, publishWebphoneDial, reserveWebphoneDial } from '@/features/integrations/webphone/webphone-dial-correlation';
import { getWebphoneState, prepareWebphoneMicForDial } from '@/features/integrations/webphone/webphone-client';
import { dialingBlockReason } from '@/features/integrations/webphone/webphone-state';

import {
  concludeAutoDialCallAction,
  confirmAutoDialOutcomeAction,
  dialAutoLeadAction,
  getNextAutoDialCardAction,
  resolveAutoDialNoAnswerAction,
} from '../actions/auto-dial';
import type { AutoDialBlockCode, AutoDialGateCode, AutoDialLeadCardExtras } from '../auto-dial.types';
import type { NextCallCardData } from '../types';
import {
  describeCockpitAutoDial,
  initialCockpitAutoDialState,
  noAnswerEvent,
  reduceCockpitAutoDial,
  type CockpitAutoDialState,
} from '../utils/cockpit-auto-dial-machine';
import type { ExternalConclusionKind } from '../utils/external-conclusion';
import {
  TAB_LOCK_HEARTBEAT_MS,
  TAB_LOCK_MESSAGE,
  acquireTabLock,
  refreshTabLock,
  releaseTabLock,
} from '../utils/auto-dial-tab-lock';
import { nextRamalBusyStep } from '../utils/ramal-busy-retry';
import type { CockpitTier } from '../utils/next-call-pick';
import type { AutoDialQueue } from '../utils/recovery-queue';
import { simulateDial, type SimulatedScript } from '../utils/simulated-dialer';

/**
 * Laço do motor automático do Cockpit (plano §3.3). COPIADO conceitualmente do `PowerDialerTab` (D1): a Execução
 * não é editada, só se importam funções puras. Toda trava é decidida no SERVIDOR (as actions); aqui só se executam
 * os efeitos (timers, discar, acompanhar a sessão SIP) e se mostra o estado.
 *
 *  - FR-1/D8: nasce Desligado; nunca lê nem grava `localStorage`.
 *  - FR-13: Parar volta a Desligado e NÃO derruba a ligação em curso (nenhum `hangup` aqui).
 *  - FR-17: a lista de excluídos acumula na sessão (ref).
 *  - FR-18: sem `live` usa o discador simulado: nada vai à API4COM e nenhuma linha nasce em `calls`.
 */

/** Roteiro padrão do modo simulado: 1ª não atende, 2ª atende (mostra os dois caminhos ao SDR). */
export const DEFAULT_SIMULATED_SCRIPT: SimulatedScript = ['no_answer', 'answered'];

/** Mensagem quando o servidor decide um modo (simulado/real) diferente do que a página esperava. */
export const LIVE_MISMATCH_MESSAGE = 'O modo do motor mudou (simulado/real). Recarregue a página para continuar.';
/** `too_soon` seguidos (≈5 s cada) antes de pausar: ligação sua em curso ou sem término que o servidor ainda não viu terminar. */
const MAX_CONSECUTIVE_TOO_SOON = 12;
const TOO_SOON_PAUSE_MESSAGE = 'Há uma ligação sua em curso ou sem término. Confira o ramal e continue quando ela acabar.';

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Recusas repetidas seguidas antes de pausar (evita laço se servidor e escolha divergirem). */
const MAX_CONSECUTIVE_REFUSALS = 5;
/** Espera entre tentativas de registrar a 3ª não atendida enquanto a operadora não confirma. */
const NO_ANSWER_RETRY_MS = 2_000;
const NO_ANSWER_MAX_RETRIES = 5;

const BLOCK_CODES: ReadonlySet<AutoDialGateCode> = new Set<AutoDialBlockCode>(['outside_hours', 'holiday', 'daily_cap']);
/** Mudou entre a escolha e a discagem: o lead sai desta sessão e o motor escolhe outro (FR-10). */
const SKIP_CODES: ReadonlySet<AutoDialGateCode> = new Set<AutoDialGateCode>([
  'held',
  'attempts',
  'answered_today',
  'not_owner',
  'no_phone',
  'lead_unavailable',
]);

type CallPhase = 'idle' | 'awaiting-session' | 'connected' | 'ended';

export interface UseCockpitAutoDialOptions {
  /** `call_cockpit_outcomes` + `cockpit_auto_dial`. Desligado = o hook não faz nada. */
  enabled: boolean;
  /** `cockpit_auto_dial_live` (as 3 flags). Sem ela o motor é SIMULADO. */
  live: boolean;
  script?: SimulatedScript;
  /** Fila do motor: 'normal' (padrão) ou 'recovery' (perdidos). Repassada ao servidor em toda escolha e discagem. */
  queue?: AutoDialQueue;
}

export interface UseCockpitAutoDialResult {
  state: CockpitAutoDialState;
  statusText: string | null;
  card: NextCallCardData | null;
  tier: CockpitTier | null;
  /** Contexto extra do lead atual (origem, perda, último SDR). Ausente/null = não carregou. */
  leadCardExtras?: AutoDialLeadCardExtras | null;
  /** Motivo de o Iniciar não ter começado (ex.: o motor já roda em outra aba). */
  startError?: string | null;
  /** Leads pulados nesta sessão por número inválido (422), com o motivo (A-D12). */
  skippedLeads?: ReadonlyArray<{ leadId: string; reason: string }>;
  simulated: boolean;
  callId: string | null;
  attemptNo: number | null;
  start: () => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  /** SDR confirma o desfecho (FR-9): libera o motor para o próximo lead. Devolve false se falhou. */
  confirmOutcome: (input: { disposition: CallDisposition; notes?: string }) => Promise<boolean>;
  /**
   * O SDR agendou reunião ou desqualificou o lead pelo painel durante a ligação do motor: vale como desfecho e o
   * motor segue SEM o Confirmar. O lead sai da sessão. Nunca derruba a ligação (se ainda está no ar, o motor só
   * avança quando ela terminar). Ignora lead que não é o atual e é idempotente.
   */
  concludeExternally?: (leadId: string, kind: ExternalConclusionKind) => void;
}

interface CurrentLead {
  leadId: string;
  leadName: string | null;
  phone: string | null;
  card: NextCallCardData;
  tier: CockpitTier;
}

/** Dá à ligação o desfecho mínimo (o servidor decide pelo que a operadora informou). Simulado: só aviso. */
async function recordConclusion(live: boolean, conclusion: { callId: string | null; kind: ExternalConclusionKind }): Promise<void> {
  if (!live || !conclusion.callId) {
    console.warn('[cockpit-auto-dial] simulado: desfecho da conclusão pelo painel NÃO gravado', conclusion.kind);
    return;
  }
  for (let i = 0; i <= NO_ANSWER_MAX_RETRIES; i++) {
    const r = await concludeAutoDialCallAction({ callId: conclusion.callId, kind: conclusion.kind }).catch(() => null);
    if (!r?.success || r.data.status !== 'pending') return;
    await new Promise((resolve) => setTimeout(resolve, NO_ANSWER_RETRY_MS));
  }
  console.error('[cockpit-auto-dial] a operadora não informou o atendimento a tempo; desfecho da ligação não gravado');
}

export function useCockpitAutoDial({ enabled, live, script = DEFAULT_SIMULATED_SCRIPT, queue = 'normal' }: UseCockpitAutoDialOptions): UseCockpitAutoDialResult {
  const [state, dispatch] = useReducer(reduceCockpitAutoDial, initialCockpitAutoDialState);
  const [card, setCard] = useState<NextCallCardData | null>(null);
  const [tier, setTier] = useState<CockpitTier | null>(null);
  const [leadCardExtras, setLeadCardExtras] = useState<AutoDialLeadCardExtras | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [skippedLeads, setSkippedLeads] = useState<Array<{ leadId: string; reason: string }>>([]);
  const [callId, setCallId] = useState<string | null>(null);
  const [attemptNo, setAttemptNo] = useState<number | null>(null);
  const [dialToken, setDialToken] = useState<string | null>(null);
  const [callPhase, setCallPhase] = useState<CallPhase>('idle');

  const webphone = useApi4ComWebphone();

  const excluded = useRef(new Set<string>());
  const simulatedAttempts = useRef<Record<string, string[]>>({});
  const current = useRef<CurrentLead | null>(null);
  const loading = useRef<Promise<CurrentLead | null> | null>(null);
  const dialTokenRef = useRef<string | null>(null);
  const confirmedRef = useRef(false);
  const sessionEndedAtRef = useRef<number | null>(null);
  const ramalBusyFirstAtRef = useRef<number | null>(null);
  const refusalsRef = useRef(0);
  const tooSoonRef = useRef(0);
  const tabId = useRef<string | null>(null);
  const attemptNoRef = useRef(0);
  const concluded = useRef(new Set<string>());
  const concludedCalls = useRef(new Set<string>());
  const pendingConclusion = useRef<{ callId: string | null; kind: ExternalConclusionKind } | null>(null);
  const prevPhase = useRef<CockpitAutoDialState['phase']>('off');

  const isOn = state.phase !== 'off';

  // ---------------------------------------------------------------------------
  // Próximo lead (servidor): a cada volta à contagem
  // ---------------------------------------------------------------------------

  const loadNext = useEffectEvent(async (): Promise<CurrentLead | null> => {
    const result = await getNextAutoDialCardAction({
      ...(queue === 'recovery' ? { queue } : {}),
      excludeLeadIds: [...excluded.current],
      ...(live ? {} : { simulatedAttempts: simulatedAttempts.current }),
    }).catch(() => null);
    if (!result || !result.success) {
      dispatch({ type: 'pause', reason: 'blocked', message: result && !result.success ? result.error : 'Falha ao escolher o próximo lead' });
      return null;
    }
    const data = result.data;
    if (data.status === 'ok') {
      const ctx = data.card.context;
      const next: CurrentLead = {
        leadId: ctx.leadId,
        leadName: ctx.decisionMaker.name ?? ctx.company.name,
        phone: ctx.decisionMaker.phone,
        card: data.card,
        tier: data.tier,
      };
      current.current = next;
      setCard(next.card);
      setTier(next.tier);
      setLeadCardExtras(data.leadCardExtras ?? null);
      return next;
    }
    current.current = null;
    setCard(null);
    setTier(null);
    setLeadCardExtras(null);
    if (data.status === 'waiting') dispatch({ type: 'wait', until: data.until });
    else if (data.status === 'blocked') dispatch({ type: 'blocked', reason: data.code });
    else if (data.status === 'empty') dispatch({ type: 'blocked', reason: 'empty' });
    else dispatch({ type: 'stop' });
    return null;
  });

  // Entrou numa contagem nova: busca o lead enquanto os 5 s correm.
  const freshCountdown = state.phase === 'countdown' && state.secondsLeft === AUTO_DIAL_COUNTDOWN_SECONDS;
  useEffect(() => {
    if (!freshCountdown) return;
    current.current = null;
    loading.current = loadNext();
  }, [freshCountdown]);

  // Contagem regressiva: um tique por segundo.
  useEffect(() => {
    if (state.phase !== 'countdown') return;
    const t = setTimeout(() => dispatch({ type: 'tick' }), 1000);
    return () => clearTimeout(t);
  }, [state]);

  // ---------------------------------------------------------------------------
  // Discar
  // ---------------------------------------------------------------------------

  const onRefused = useEffectEvent((leadId: string, code: AutoDialGateCode) => {
    if (BLOCK_CODES.has(code)) {
      dispatch({ type: 'blocked', reason: code as AutoDialBlockCode });
      return;
    }
    if (code === 'flag_off') {
      dispatch({ type: 'stop' });
      return;
    }
    if (code === 'live_mismatch') {
      // As flags mudaram com a página aberta: nada foi discado. Pausa, zera as tentativas desta sessão e pede para recarregar.
      simulatedAttempts.current = {};
      refusalsRef.current = 0;
      tooSoonRef.current = 0;
      dispatch({ type: 'dial_failed', message: LIVE_MISMATCH_MESSAGE });
      return;
    }
    if (code === 'too_soon') {
      // Ligação sua recente ou sem término: espera e escolhe de novo (sem excluir o lead), até um limite.
      tooSoonRef.current += 1;
      if (tooSoonRef.current >= MAX_CONSECUTIVE_TOO_SOON) {
        tooSoonRef.current = 0;
        dispatch({ type: 'dial_failed', message: TOO_SOON_PAUSE_MESSAGE });
        return;
      }
      dispatch({ type: 'next_lead' });
      return;
    }
    refusalsRef.current += 1;
    if (code === 'error' || refusalsRef.current >= MAX_CONSECUTIVE_REFUSALS) {
      dispatch({ type: 'dial_failed', message: 'O servidor recusou a discagem. O motor parou para conferência.' });
      return;
    }
    if (SKIP_CODES.has(code)) excluded.current.add(leadId);
    dispatch({ type: 'next_lead' });
  });

  /** Fim simulado: espera a duração fictícia, encerra e entrega o resultado ao redutor. */
  const runSimulatedCall = useEffectEvent((leadId: string, no: number, answered: boolean, endsAfterMs: number) => {
    window.setTimeout(() => {
      dispatch({ type: 'call_ended' });
      dispatch(answered ? { type: 'lead_answer', answer: 'answered' } : noAnswerEvent(no));
      void leadId;
    }, endsAfterMs);
  });

  /** 422: pula o lead (fica excluído da sessão com o motivo) e segue; conta no limite de recusas seguidas. */
  const skipForInvalidNumber = useEffectEvent((leadId: string, reason: string) => {
    excluded.current.add(leadId);
    setSkippedLeads((prev) => [...prev, { leadId, reason }]);
    toast.info('Número inválido: lead pulado nesta sessão.');
    refusalsRef.current += 1;
    if (refusalsRef.current >= MAX_CONSECUTIVE_REFUSALS) {
      dispatch({ type: 'dial_failed', message: 'Vários números inválidos seguidos. O motor parou para conferência.' });
      return;
    }
    dispatch({ type: 'next_lead' });
  });

  const onDial = useEffectEvent(async () => {
    const lead = (await loading.current) ?? current.current;
    if (!lead) return; // `loadNext` já levou o motor a espera, bloqueio ou pausa
    const no = (simulatedAttempts.current[lead.leadId]?.length ?? 0) + 1;

    if (live) {
      const blocked = dialingBlockReason(getWebphoneState());
      if (blocked) {
        dispatch({ type: 'pause', reason: 'blocked', message: blocked });
        return;
      }
    }
    const reserved = live && lead.phone ? reserveWebphoneDial(lead.phone) : null;
    if (reserved) {
      dialTokenRef.current = reserved.token;
      setDialToken(reserved.token);
    }
    confirmedRef.current = false;

    const result = await dialAutoLeadAction({ leadId: lead.leadId, expectLive: live, ...(queue === 'recovery' ? { queue } : {}) }).catch(() => null);
    if (!result || !result.success) {
      if (reserved) cancelWebphoneDial(reserved.token);
      // Não se sabe se a operadora criou a chamada: não repetir sozinho.
      dispatch({ type: 'dial_failed', message: result && !result.success ? result.error : 'Não sei se a operadora criou a ligação. A discagem parou.' });
      return;
    }
    const r = result.data;

    if (r.status === 'refused') {
      if (reserved) cancelWebphoneDial(reserved.token);
      onRefused(lead.leadId, r.code);
      return;
    }
    if (r.status === 'invalid_number') {
      // A-D12 (422): número inválido. O lead sai da sessão, com o motivo, e o motor segue para o próximo.
      if (reserved) cancelWebphoneDial(reserved.token);
      skipForInvalidNumber(lead.leadId, r.error);
      return;
    }
    refusalsRef.current = 0;

    if (r.status === 'ramal_busy') {
      // A-D11 (424): tenta de novo a cada 5 s por até 1 min; depois pausa com o motivo.
      if (reserved) cancelWebphoneDial(reserved.token);
      const step = nextRamalBusyStep({ firstBusyAt: ramalBusyFirstAtRef.current, now: Date.now() });
      ramalBusyFirstAtRef.current = step.firstBusyAt;
      if (step.action === 'wait') {
        dispatch({ type: 'ramal_busy', until: Date.now() + step.waitMs });
        return;
      }
      dispatch({ type: 'dial_failed', message: RAMAL_BUSY_PAUSE_MESSAGE });
      return;
    }

    tooSoonRef.current = 0;
    attemptNoRef.current = r.attemptNo;
    setAttemptNo(r.attemptNo);

    if (r.status === 'simulated') {
      // FR-18: discador falso. Nada de API4COM e nada em `calls`.
      simulatedAttempts.current = { ...simulatedAttempts.current, [lead.leadId]: [...(simulatedAttempts.current[lead.leadId] ?? []), new Date().toISOString()] };
      const sim = simulateDial({ leadId: lead.leadId, attemptNo: no, script });
      if (sim.kind === 'ramal_busy') {
        const step = nextRamalBusyStep({ firstBusyAt: ramalBusyFirstAtRef.current, now: Date.now() });
        ramalBusyFirstAtRef.current = step.firstBusyAt;
        if (step.action === 'wait') dispatch({ type: 'ramal_busy', until: Date.now() + step.waitMs });
        else dispatch({ type: 'dial_failed', message: RAMAL_BUSY_PAUSE_MESSAGE });
        return;
      }
      if (sim.kind === 'failed') {
        dispatch({ type: 'dial_failed', message: sim.message });
        return;
      }
      ramalBusyFirstAtRef.current = null;
      setCallId(sim.callId);
      dispatch({ type: 'dial_started' });
      runSimulatedCall(lead.leadId, r.attemptNo, sim.answered, sim.endsAfterMs);
      return;
    }

    // Ligação REAL (as 3 flags, decidido no servidor).
    ramalBusyFirstAtRef.current = null;
    setCallId(r.callId);
    if (reserved) {
      publishWebphoneDial(reserved.seq, () =>
        setWebphoneCallContext({
          callId: r.callId,
          providerCallId: r.providerCallId,
          leadId: lead.leadId,
          leadName: lead.leadName,
          phone: lead.phone ?? '',
          ownerHandlesResult: true,
          dialToken: reserved.token,
        }),
      );
    }
    const relation = sessionOfThisDial(getWebphoneState().call, reserved?.token ?? null);
    if (relation === 'live') {
      confirmedRef.current = true;
      setCallPhase('connected');
      dispatch({ type: 'dial_started' });
    } else if (relation === 'ended') {
      confirmedRef.current = true;
      sessionEndedAtRef.current = Date.now();
      setCallPhase('ended');
      dispatch({ type: 'dial_started' });
    } else {
      setCallPhase('awaiting-session');
      dispatch({ type: 'awaiting_session' });
    }
  });
  useEffect(() => {
    if (state.phase === 'dialing') void onDial();
  }, [state.phase]);

  // 424 confirmado: uma espera até a folga do ramal e um único POST seguinte (FR-15).
  useEffect(() => {
    if (state.phase !== 'releasing') return;
    const t = setTimeout(() => dispatch({ type: 'ramal_retry' }), Math.max(state.until - Date.now(), 0));
    return () => clearTimeout(t);
  }, [state]);

  // ---------------------------------------------------------------------------
  // Sessão SIP desta aba (só no modo real): cópia do PowerDialerTab
  // ---------------------------------------------------------------------------

  const localRelation = live ? sessionOfThisDial(webphone.call, dialToken) : 'none';

  useEffect(() => {
    if (!live) return;
    if (localRelation === 'live' && callPhase === 'awaiting-session') {
      confirmedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- espelha a sessão SIP desta aba
      setCallPhase('connected');
      dispatch({ type: 'session_confirmed' });
      return;
    }
    if (localRelation === 'ended' && (callPhase === 'connected' || callPhase === 'awaiting-session')) {
      confirmedRef.current = true;
      sessionEndedAtRef.current = Date.now();
      setCallPhase('ended');
      dispatch({ type: 'session_confirmed' });
    }
  }, [live, localRelation, callPhase]);

  // POST ok mas a sessão desta aba não entrou na ligação em 2 s: pausa e não repete (FR-15).
  useEffect(() => {
    if (!live || callPhase !== 'awaiting-session' || localRelation !== 'none') return;
    const tokenAtStart = dialTokenRef.current;
    const t = setTimeout(() => {
      if (dialTokenRef.current !== tokenAtStart) return;
      const later = sessionOfThisDial(getWebphoneState().call, tokenAtStart);
      if (later === 'live') {
        confirmedRef.current = true;
        setCallPhase('connected');
        dispatch({ type: 'session_confirmed' });
        return;
      }
      if (later === 'ended') {
        confirmedRef.current = true;
        sessionEndedAtRef.current = Date.now();
        setCallPhase('ended');
        dispatch({ type: 'session_confirmed' });
        return;
      }
      if (tokenAtStart) cancelWebphoneDial(tokenAtStart);
      setCallPhase('idle');
      dispatch({ type: 'session_missing', message: SESSION_MISSING_MESSAGE });
    }, LOCAL_SESSION_GRACE_MS);
    return () => clearTimeout(t);
  }, [live, callPhase, localRelation]);

  // O servidor encerrou antes do BYE (hangup_cause gravado pelo webhook).
  useCallHangupDetection({
    callId: live ? callId : null,
    isActive: live && (callPhase === 'connected' || callPhase === 'awaiting-session'),
    onHangup: () => {
      if (sessionOfThisDial(getWebphoneState().call, dialTokenRef.current) === 'live') return;
      if (!confirmedRef.current) {
        if (dialTokenRef.current) cancelWebphoneDial(dialTokenRef.current);
        setCallPhase('idle');
        dispatch({ type: 'session_missing', message: SESSION_MISSING_MESSAGE });
        return;
      }
      sessionEndedAtRef.current = Date.now();
      setCallPhase('ended');
    },
  });

  useEffect(() => {
    if (live && (state.phase === 'in-call' || state.phase === 'concluded-call') && callPhase === 'ended') dispatch({ type: 'call_ended' });
  }, [live, state.phase, callPhase]);

  // O LEAD atendeu? (webhook da API4COM; "unknown" até ele chegar.) Atender o ramal não é atender o lead.
  const leadAnswer = useWebphoneLeadAnswer(live && callPhase === 'ended' ? callId : null);
  useEffect(() => {
    if (!live || state.phase !== 'resolving') return;
    if (leadAnswer === 'answered') {
      dispatch({ type: 'lead_answer', answer: 'answered' }); // FR-8: pausa e espera o SDR
      return;
    }
    if (leadAnswer === 'not_answered') {
      dispatch(noAnswerEvent(attemptNoRef.current)); // FR-6/FR-7
      return;
    }
    const t = setTimeout(() => dispatch({ type: 'answer_timeout' }), AUTO_DIAL_ANSWER_TIMEOUT_MS); // FR-16
    return () => clearTimeout(t);
  }, [live, state.phase, leadAnswer]);

  // Não atendeu na 1ª/2ª: volta para a contagem do próximo lead (o servidor devolve este lead só após 1 h).
  useEffect(() => {
    if (state.phase === 'advancing') dispatch({ type: 'next_lead' });
  }, [state.phase]);

  // Todos em espera: acorda quando o primeiro lead fica liberado (FR-5).
  useEffect(() => {
    if (state.phase !== 'waiting') return;
    const delay = Math.min(Math.max(state.until - Date.now(), 0) + 1000, 2 ** 31 - 1);
    const t = setTimeout(() => dispatch({ type: 'wake' }), delay);
    return () => clearTimeout(t);
  }, [state]);

  // 3ª não atendida do dia: o servidor grava `no_answer` sem avançar a cadência (FR-7). Simulado: só aviso.
  const onAutoComplete = useEffectEvent(async () => {
    if (!live || !callId) {
      console.warn('[cockpit-auto-dial] simulado: no_answer NÃO gravado (3ª tentativa)');
      toast.info('Simulado: não atendeu na 3ª tentativa (nada foi gravado).');
      dispatch({ type: 'completed' });
      return;
    }
    for (let i = 0; i <= NO_ANSWER_MAX_RETRIES; i++) {
      const r = await resolveAutoDialNoAnswerAction({ callId }).catch(() => null);
      if (r?.success && (r.data.status === 'recorded' || r.data.status === 'not_last')) {
        dispatch({ type: 'completed' });
        return;
      }
      if (!r?.success || (r.data.status !== 'pending')) break;
      await new Promise((resolve) => setTimeout(resolve, NO_ANSWER_RETRY_MS));
    }
    dispatch({ type: 'complete_failed', message: 'Não consegui registrar a ligação não atendida' });
  });
  const autoCompleting = state.phase === 'auto-completing';
  useEffect(() => {
    if (autoCompleting) void onAutoComplete();
  }, [autoCompleting]);

  // Lock de aba: renova enquanto o motor está ligado; solta ao desligar e ao desmontar. Outra aba assumiu = pausa.
  const running = state.phase !== 'off';
  useEffect(() => {
    const id = tabId.current;
    if (!id) return;
    if (!running) {
      releaseTabLock(browserStorage(), id);
      return;
    }
    const t = setInterval(() => {
      if (!refreshTabLock(browserStorage(), id, Date.now())) dispatch({ type: 'pause', reason: 'blocked', message: 'O motor passou para outra aba.' });
    }, TAB_LOCK_HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [running]);
  useEffect(
    () => () => {
      if (tabId.current) releaseTabLock(browserStorage(), tabId.current);
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Conclusão pelo painel (Agendar reunião / Desqualificar)
  // ---------------------------------------------------------------------------

  // A ligação terminou (o motor saiu de `concluded-call`): grava o desfecho pendente.
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = state.phase;
    if (was === 'concluded-call' && state.phase !== 'concluded-call' && pendingConclusion.current) {
      const pending = pendingConclusion.current;
      pendingConclusion.current = null;
      void recordConclusion(live, pending);
    }
  }, [state.phase, live]);

  function concludeExternally(leadId: string, kind: ExternalConclusionKind) {
    const lead = current.current;
    if (!lead || lead.leadId !== leadId) return; // lead que não é o atual: ignorado
    if (concluded.current.has(leadId)) return; // já concluído: idempotente
    const phase = state.phase;
    const onAir = phase === 'awaiting-session' || phase === 'in-call';
    const ended = phase === 'resolving' || phase === 'awaiting-sdr' || phase === 'auto-completing';
    if (!onAir && !ended) return; // fora de uma ligação do motor: ignorado
    concluded.current.add(leadId);
    if (callId) concludedCalls.current.add(callId);
    excluded.current.add(leadId); // o lead sai da sessão do motor (FR-17)
    if (onAir) pendingConclusion.current = { callId, kind }; // grava quando a ligação terminar (o fim da sessão SIP ainda é observado)
    else {
      setCallPhase('idle');
      void recordConclusion(live, { callId, kind });
    }
    dispatch({ type: 'concluded_externally' });
  }

  // ---------------------------------------------------------------------------
  // Controles
  // ---------------------------------------------------------------------------

  async function start() {
    if (!enabled || isOn) return;
    if (live) {
      // O microfone é pedido no mesmo clique; negado = não inicia.
      const pendingMic = prepareWebphoneMicForDial();
      const micBlock = pendingMic ? await pendingMic : null;
      if (micBlock) {
        toast.error(micBlock, { duration: 6000 });
        return;
      }
    }
    // Uma aba só por navegador: no simulado também.
    const id = tabId.current ?? (tabId.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    const lock = acquireTabLock(browserStorage(), id, Date.now());
    if (!lock.ok) {
      setStartError(TAB_LOCK_MESSAGE);
      toast.error(TAB_LOCK_MESSAGE);
      return;
    }
    setStartError(null);
    tooSoonRef.current = 0;
    excluded.current = new Set();
    concluded.current = new Set();
    concludedCalls.current = new Set();
    pendingConclusion.current = null;
    refusalsRef.current = 0;
    ramalBusyFirstAtRef.current = null;
    dispatch({ type: 'start' });
  }

  // Parar NÃO derruba a ligação em curso (FR-13): o botão Desligar é separado.
  function stop() {
    dispatch({ type: 'stop' });
  }

  async function confirmOutcome(input: { disposition: CallDisposition; notes?: string }): Promise<boolean> {
    const lead = current.current;
    // Já concluído pelo painel (o lead ou a ligação): clique atrasado é ignorado, mesmo depois de o motor seguir.
    if ((lead && concluded.current.has(lead.leadId)) || (callId && concludedCalls.current.has(callId))) return true;
    if (live && callId) {
      const r = await confirmAutoDialOutcomeAction({ callId, disposition: input.disposition, notes: input.notes }).catch(() => null);
      if (!r?.success) {
        toast.error(r && !r.success ? r.error : 'Falha ao registrar o desfecho');
        return false;
      }
    } else {
      console.warn('[cockpit-auto-dial] simulado: desfecho NÃO gravado', input.disposition);
      toast.info('Simulado: desfecho não foi gravado.');
    }
    if (lead) excluded.current.add(lead.leadId); // atendido sai da sessão (o servidor também tira, FR-9b)
    setCallPhase('idle');
    dispatch({ type: 'sdr_concluded' });
    return true;
  }

  return {
    state,
    statusText: describeCockpitAutoDial(state),
    card,
    tier,
    simulated: !live,
    callId,
    attemptNo,
    start,
    stop,
    pause: () => dispatch({ type: 'pause', reason: 'user' }),
    resume: () => dispatch({ type: 'resume' }),
    confirmOutcome,
    concludeExternally,
    startError,
    leadCardExtras,
    skippedLeads,
  };
}
