'use client';

import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react';

import { toast } from 'sonner';

import { scheduleActivity } from '@/features/activities/actions/schedule-activity';
import { useCallHangupDetection } from '@/features/calls/hooks/use-call-hangup-detection';
import type { CallDisposition } from '@/features/calls/types';
import { AUTO_DIAL_ANSWER_TIMEOUT_MS, AUTO_DIAL_COUNTDOWN_SECONDS } from '@/features/activities/utils/auto-dialer';
import {
  RAMAL_BUSY_PAUSE_MESSAGE,
  SESSION_MISSING_MESSAGE,
  sessionOfThisDial,
} from '@/features/activities/utils/power-dialer-webphone-sync';
import { useApi4ComWebphone } from '@/features/integrations/webphone/useApi4ComWebphone';
import { useWebphoneLeadAnswer } from '@/features/integrations/webphone/useWebphoneLeadAnswer';
import { requestWebphoneAutoConclude, setWebphoneCallContext } from '@/features/integrations/webphone/webphone-call-context';
import { cancelWebphoneDial, publishWebphoneDial, reserveWebphoneDial } from '@/features/integrations/webphone/webphone-dial-correlation';
import { getWebphoneState, prepareWebphoneMicForDial } from '@/features/integrations/webphone/webphone-client';
import { dialingBlockReason } from '@/features/integrations/webphone/webphone-state';

import {
  classifyAutoDialAnsweredAction,
  concludeAutoDialCallAction,
  confirmAutoDialOutcomeAction,
  dialAutoLeadAction,
  getAutoDialCarrierHangupAction,
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
import { validateCallbackAt } from '../utils/callback-slots';
import type { ExternalConclusionKind } from '../utils/external-conclusion';
import type { ScheduleCallbackFn } from '../components/MotorCallbackDialog';
import {
  TAB_LOCK_HEARTBEAT_MS,
  TAB_LOCK_MESSAGE,
  acquireTabLock,
  refreshTabLock,
  releaseTabLock,
} from '../utils/auto-dial-tab-lock';
import { AUTO_CONCLUDE_NO_CONVERSATION } from '../utils/auto-conclude';
import { COCKPIT_ANSWER_TIMEOUT_MS } from '../utils/cockpit-answer-timeout';
import { COCKPIT_SESSION_GRACE_MS, COCKPIT_SESSION_MISSING_MESSAGE } from '../utils/cockpit-session-grace';
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
export const LIVE_MISMATCH_MESSAGE = 'O modo da discagem mudou (simulado/real). Recarregue a página para continuar.';
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
/** Espera entre consultas do veredito "conversou?" enquanto a duração da ligação não fechou. */
const ANSWERED_VERDICT_RETRY_MS = 2_000;
/** Avisos curtos na barra quando o lead volta para a fila sozinho. */
export const NOT_ANSWERED_NOTICE = 'Não atendeu: volta para a fila';
export const VOICEMAIL_NOTICE = 'Caixa postal: volta para a fila';

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
  /** Pausa por sessão que não entrou: id do lead cuja ligação pode ainda aparecer. O painel dele fica aberto. */
  callLostLeadId?: string | null;
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
  /**
   * "Ligar depois": agenda o retorno do lead atual e confirma o desfecho `callback_requested` (o motor segue). Chamar
   * na fase `awaiting-sdr`. Ao contrário dos outros desfechos, o lead NÃO sai da sessão: o servidor o segura até o
   * retorno vencer. Real: `scheduleActivity` e DEPOIS o desfecho; se o retorno falhar nada é confirmado; se só o desfecho
   * falhar, tentar de novo reenvia só o desfecho (o retorno não é regravado). Simulado: nada é gravado.
   * Com `disposition: 'referred_contact'` ("Indicou outra pessoa") o caminho é o mesmo, só muda o desfecho gravado.
   */
  scheduleCallback?: ScheduleCallbackFn;
  /**
   * Link "Não foi conversa" (PR-C): em `awaiting-sdr`, trata a ligação como NÃO atendida (1ª/2ª sem gravar, 3ª grava
   * caixa postal/não atendeu). O lead NÃO sai da sessão: segue a regra normal da fila. Simulado: só segue.
   */
  notConversation?: () => void;
  /** Aviso curto da última ligação que voltou para a fila sozinha (já somado ao `statusText` durante a contagem). */
  notice?: string | null;
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
  // Aviso "volta para a fila": só vale para a ligação (callId) que o gerou; some sozinho quando a próxima nasce.
  const [noticeState, setNoticeState] = useState<{ callId: string | null; text: string } | null>(null);

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
  // Ligações cujo retorno ("Ligar depois") já foi gravado: tentar de novo reenvia só o desfecho.
  const callbackScheduledCalls = useRef(new Set<string>());
  // Ligações atendidas que viraram "não atendida" (veredito ou "Não foi conversa"): o servidor precisa saber.
  const notConversationCalls = useRef(new Set<string>());
  // Ligações decididas pela escuta (auto_hangup): o webhook com hangup_cause pode levar ~45 s, então o 3º `no_answer` espera mais.
  const carrierHangupCalls = useRef(new Set<string>());
  const pendingConclusion = useRef<{ callId: string | null; kind: ExternalConclusionKind } | null>(null);
  const prevPhase = useRef<CockpitAutoDialState['phase']>('off');
  // Lead cuja ligação ficou sem a sessão desta aba (pausa por `session_missing`): o painel dele segue aberto e as ações valem.
  const [lostLeadId, setLostLeadId] = useState<string | null>(null);
  const lostLeadRef = useRef<string | null>(null);
  // Ligação REAL deste motor e o lead a que ela pertence (gravada no momento em que a discagem devolve o callId). O `callId` do
  // estado/closure pode ser o da ligação ANTERIOR (durante `dialing`, ou numa closure velha depois de um await).
  const dialedCall = useRef<{ leadId: string; callId: string } | null>(null);
  const markSessionLost = () => {
    const id = current.current?.leadId ?? null;
    lostLeadRef.current = id;
    setLostLeadId(id);
  };
  const clearSessionLost = () => {
    lostLeadRef.current = null;
    setLostLeadId(null);
  };
  // Fase mais recente: o painel conclui o lead depois de diálogos/awaits e a ligação pode ter mudado de fase nesse meio tempo.
  const phaseRef = useRef<CockpitAutoDialState['phase']>('off');
  const pauseWhenFree = useRef<string | null>(null);
  useEffect(() => {
    phaseRef.current = state.phase;
  }, [state.phase]);

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
      dispatch({ type: 'dial_failed', message: 'O servidor recusou a discagem. A discagem parou para conferência.' });
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
      dispatch({ type: 'dial_failed', message: 'Vários números inválidos seguidos. A discagem parou para conferência.' });
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
      // Diagnóstico do 424: estado do webphone desta aba no momento da recusa (sem número, nome ou id).
      const wp = getWebphoneState();
      console.warn('[cockpit-auto-dial] 424 ramal ocupado', {
        registration: wp.registration,
        hasCall: wp.call != null,
        callPhase: wp.call?.phase ?? null,
        sipSessionOpen: wp.call != null && wp.call.endedAt == null,
        sessionConflict: wp.sessionConflict != null,
      });
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
    // O SDR agiu sobre o lead (agendou/desqualificou/ligar depois) ENQUANTO a discagem estava saindo: a ligação nasceu,
    // mas o lead já está concluído. Depois do `dial_started` o motor entra em `concluded-call` e só segue ao fim dela.
    const applyDeferredConclusion = (nowCallId: string | null) => {
      if (!concluded.current.has(lead.leadId)) return;
      if (pendingConclusion.current && !pendingConclusion.current.callId) pendingConclusion.current = { ...pendingConclusion.current, callId: nowCallId };
      if (nowCallId) concludedCalls.current.add(nowCallId);
      dispatch({ type: 'concluded_externally' });
    };
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
      dialedCall.current = { leadId: lead.leadId, callId: sim.callId };
      setCallId(sim.callId);
      dispatch({ type: 'dial_started' });
      applyDeferredConclusion(sim.callId);
      runSimulatedCall(lead.leadId, r.attemptNo, sim.answered, sim.endsAfterMs);
      return;
    }

    // Ligação REAL (as 3 flags, decidido no servidor).
    ramalBusyFirstAtRef.current = null;
    dialedCall.current = { leadId: lead.leadId, callId: r.callId };
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
          hideNotes: true, // a anotação que vale é a do painel do lead (grava na ligação)
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
    applyDeferredConclusion(r.callId);
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

  // POST ok mas a sessão desta aba não entrou na ligação em COCKPIT_SESSION_GRACE_MS (15 s): pausa e não repete (FR-15).
  // Enquanto espera, a reserva do token fica de pé (um INVITE atrasado ainda é reconhecido); só ao estourar ela é cancelada.
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
      markSessionLost();
      dispatch({ type: 'session_missing', message: COCKPIT_SESSION_MISSING_MESSAGE });
    }, COCKPIT_SESSION_GRACE_MS);
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
        // O servidor encerrou a ligação antes de a sessão entrar: ela NÃO vai aparecer depois, então o painel não fica aberto
        // (a marca `callLostLeadId` e a mensagem "pode ainda aparecer" são só do estouro do prazo).
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
      if (!callId) {
        dispatch({ type: 'lead_answer', answer: 'answered' }); // FR-8: pausa e espera o SDR
        return;
      }
      // PR-B: atendida não é conversa. O servidor cruza duração e escuta ao vivo; sem dados no prazo, conversou (fail-open).
      let cancelled = false;
      let decided = false;
      // Rede de segurança: se a server action travar, o prazo de 20 s ainda cai em "conversou" (fail-open). Só uma das
      // duas saídas age (o laço ou este timeout) e ambas morrem no cleanup.
      const failOpen = setTimeout(() => {
        if (cancelled || decided) return;
        decided = true;
        dispatch({ type: 'lead_answer', answer: 'answered' });
      }, AUTO_DIAL_ANSWER_TIMEOUT_MS);
      void (async () => {
        const deadline = Date.now() + AUTO_DIAL_ANSWER_TIMEOUT_MS;
        let notConversation = false;
        let machine = false;
        for (;;) {
          const r = await classifyAutoDialAnsweredAction({ callId }).catch(() => null);
          if (cancelled || decided) return;
          if (r?.success && r.data.status === 'verdict') {
            notConversation = r.data.verdict === 'nao_conversou';
            machine = r.data.machine;
            break;
          }
          if (!r?.success || r.data.status !== 'pending' || Date.now() >= deadline) break;
          await new Promise((resolve) => setTimeout(resolve, ANSWERED_VERDICT_RETRY_MS));
          if (cancelled || decided) return;
        }
        decided = true;
        clearTimeout(failOpen);
        if (!notConversation) {
          dispatch({ type: 'lead_answer', answer: 'answered' }); // FR-8: pausa e espera o SDR
          return;
        }
        notConversationCalls.current.add(callId);
        setNoticeState({ callId, text: machine ? VOICEMAIL_NOTICE : NOT_ANSWERED_NOTICE });
        dispatch(noAnswerEvent(attemptNoRef.current));
      })();
      return () => {
        cancelled = true;
        clearTimeout(failOpen);
      };
    }
    if (leadAnswer === 'not_answered') {
      if (callId) setNoticeState({ callId, text: NOT_ANSWERED_NOTICE });
      // Webhook com o desfecho: o lead NÃO atendeu. O cartão do webphone conclui sozinho (só ligação real, com callId).
      if (callId && AUTO_CONCLUDE_NO_CONVERSATION) requestWebphoneAutoConclude(callId);
      dispatch(noAnswerEvent(attemptNoRef.current)); // FR-6/FR-7
      return;
    }
    // Sem resposta do webhook (`unknown`). Antes de entregar ao SDR, a escuta ao vivo pode já ter dito "caixa postal / não
    // atendeu" e desligado a ligação: isso é não atendida, não conversa. Consulta a linha da ligação a cada 2 s até o prazo.
    let cancelled = false;
    let poll: ReturnType<typeof setTimeout> | null = null;
    if (callId) {
      const id = callId;
      const check = async () => {
        let r: Awaited<ReturnType<typeof getAutoDialCarrierHangupAction>> | null = null;
        try {
          r = await getAutoDialCarrierHangupAction({ callId: id });
        } catch {
          r = null; // falha de rede/da action: sem decisão, tenta de novo no próximo ciclo (até o prazo de 45 s)
        }
        if (cancelled) return;
        // Só vale a marca que a escuta grava quando REALMENTE desligou (frase + predição de operadora + confiança >= 0,84).
        if (r?.success && r.data.status === 'auto_hangup') {
          notConversationCalls.current.add(id);
          carrierHangupCalls.current.add(id);
          setNoticeState({ callId: id, text: r.data.prediction === 'voicemail' ? VOICEMAIL_NOTICE : NOT_ANSWERED_NOTICE });
          if (AUTO_CONCLUDE_NO_CONVERSATION) requestWebphoneAutoConclude(id);
          dispatch(noAnswerEvent(attemptNoRef.current));
          return;
        }
        poll = setTimeout(() => void check(), ANSWERED_VERDICT_RETRY_MS);
      };
      void check();
    }
    const t = setTimeout(() => dispatch({ type: 'answer_timeout' }), COCKPIT_ANSWER_TIMEOUT_MS); // FR-16
    return () => {
      cancelled = true;
      if (poll) clearTimeout(poll);
      clearTimeout(t);
    };
  }, [live, state.phase, leadAnswer, callId]);

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
    const maxRetries = carrierHangupCalls.current.has(callId) ? Math.ceil(COCKPIT_ANSWER_TIMEOUT_MS / NO_ANSWER_RETRY_MS) : NO_ANSWER_MAX_RETRIES;
    for (let i = 0; i <= maxRetries; i++) {
      // O SDR concluiu o lead pelo painel no meio: nada de `no_answer` para ele (o desfecho já é o da conclusão).
      if (concludedCalls.current.has(callId)) return;
      const forced = notConversationCalls.current.has(callId);
      const r = await resolveAutoDialNoAnswerAction(forced ? { callId, notConversation: true } : { callId }).catch(() => null);
      if (concludedCalls.current.has(callId)) return;
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
      if (!refreshTabLock(browserStorage(), id, Date.now())) dispatch({ type: 'pause', reason: 'blocked', message: 'A discagem passou para outra aba.' });
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

  /** O caminho do botão "Pausar" (barra do motor). */
  const pause = () => dispatch({ type: 'pause', reason: 'user' });
  const pauseAndTellToCall = useEffectEvent((name: string) => pauseAndTell(name));

  // Pausa pedida com a ligação ainda em curso: vale quando o motor ficar livre (antes de discar o próximo). Não corta a ligação.
  useEffect(() => {
    const name = pauseWhenFree.current;
    if (!name) return;
    if (state.phase === 'countdown' || state.phase === 'advancing' || state.phase === 'waiting') {
      pauseWhenFree.current = null;
      pauseAndTellToCall(name);
    } else if (state.phase === 'off' || state.phase === 'paused' || state.phase === 'blocked') {
      pauseWhenFree.current = null; // o motor já parou por outro motivo
    }
  }, [state.phase]);

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
    const phase = phaseRef.current;
    const onAir = phase === 'awaiting-session' || phase === 'in-call';
    const ended = phase === 'resolving' || phase === 'awaiting-sdr' || phase === 'auto-completing';
    // `dialing`: o POST da discagem ainda está no ar (sem `callId`). A conclusão fica guardada e `onDial` a aplica quando a ligação nasce.
    const dialing = phase === 'dialing';
    // Pausa por sessão perdida: o SDR ainda conduz o lead pelo painel. O motor está parado, então só o tira da sessão.
    if (phase === 'paused' && lostLeadRef.current === leadId) {
      concluded.current.add(leadId);
      excluded.current.add(leadId);
      return;
    }
    if (!onAir && !ended && !dialing) return; // fora de uma ligação do motor: ignorado
    // Ligação do lead TRATADO: nunca o `callId` da closure (a fase muda durante diálogos/awaits e a closure pode ser da ligação
    // anterior). Sem ligação deste lead ainda (discando), a conclusão fica guardada e `onDial` a aplica quando ela nasce.
    const dialed = dialedCall.current;
    const leadCallId = dialed && dialed.leadId === leadId ? dialed.callId : null;
    const deferred = dialing || leadCallId === null;
    concluded.current.add(leadId);
    if (leadCallId && !deferred) concludedCalls.current.add(leadCallId);
    excluded.current.add(leadId); // o lead sai da sessão do motor (FR-17): sem 2ª/3ª tentativa nem volta à fila
    if (deferred) {
      pendingConclusion.current = { callId: null, kind };
      return;
    }
    if (onAir) pendingConclusion.current = { callId: leadCallId, kind }; // grava quando a ligação terminar (o fim da sessão SIP ainda é observado)
    else {
      setCallPhase('idle');
      void recordConclusion(live, { callId: leadCallId, kind });
    }
    dispatch({ type: 'concluded_externally' });
  }

  // ---------------------------------------------------------------------------
  // Controles
  // ---------------------------------------------------------------------------

  function notConversation() {
    const lead = current.current;
    if (state.phase !== 'awaiting-sdr' || !lead) return;
    if (concluded.current.has(lead.leadId) || (callId && concludedCalls.current.has(callId))) return;
    // O lead NÃO entra em `excluded`/`concluded`: segue a regra normal da fila (volta após 1 h ou fecha na 3ª).
    if (live && callId) notConversationCalls.current.add(callId);
    setNoticeState({ callId, text: NOT_ANSWERED_NOTICE });
    dispatch({ type: 'not_conversation', attemptNo: attemptNoRef.current });
  }

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
    callbackScheduledCalls.current = new Set();
    pendingConclusion.current = null;
    pauseWhenFree.current = null;
    refusalsRef.current = 0;
    ramalBusyFirstAtRef.current = null;
    clearSessionLost();
    dispatch({ type: 'start' });
  }

  // Parar NÃO derruba a ligação em curso (FR-13): o botão Desligar é separado.
  function stop() {
    dispatch({ type: 'stop' });
  }

  async function confirmOutcome(input: { disposition: CallDisposition; notes?: string }): Promise<boolean> {
    return confirmWith(input, true);
  }

  /** `excludeLead=false` só no "Ligar depois": o lead volta na sessão quando o retorno vencer (o servidor o segura até lá). */
  async function confirmWith(input: { disposition: CallDisposition; notes?: string }, excludeLead: boolean): Promise<boolean> {
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
    if (lead && excludeLead) excluded.current.add(lead.leadId); // atendido sai da sessão (o servidor também tira, FR-9b)
    setCallPhase('idle');
    dispatch({ type: 'sdr_concluded' });
    return true;
  }

  function pauseAndTell(name: string) {
    pause();
    toast.info(`Fila pausada. Ligue para ${name} e depois toque em Retomar.`);
  }

  async function scheduleCallback(input: Parameters<ScheduleCallbackFn>[0]): ReturnType<ScheduleCallbackFn> {
    const lead = current.current;
    if (!lead) return { ok: false, error: 'Nenhum lead em ligação.' };
    const disposition = input.disposition ?? 'callback_requested';
    const referred = disposition === 'referred_contact';
    const externalKind: ExternalConclusionKind = referred ? 'referred' : 'callback';
    // Reenvio só do desfecho de uma indicação: o retorno já está salvo, o horário (travado na tela) não é revalidado.
    const onlyOutcome = referred && callbackScheduledCalls.current.has(`${callId ?? `lead:${lead.leadId}`}:referred`);
    const valid = validateCallbackAt(input.scheduledAt, new Date());
    if (!valid.ok && !onlyOutcome) return valid;
    const inAwaitingSdr = state.phase === 'awaiting-sdr';
    // Discando: o POST ainda não devolveu a ligação e o `callId` do estado é o da ligação ANTERIOR (não usar).
    const lostPause = state.phase === 'paused' && lostLeadRef.current === lead.leadId;
    const dialing = state.phase === 'dialing' || lostPause;
    const thisCallId = dialing ? null : callId;
    // Já concluído (painel ou clique anterior): ignora, como o confirmOutcome.
    if (concluded.current.has(lead.leadId) || (thisCallId && concludedCalls.current.has(thisCallId))) return { ok: true };
    // Fora de uma ligação do motor (contagem, espera...): não há o que concluir.
    if (!inAwaitingSdr && !dialing && !['awaiting-session', 'in-call', 'resolving', 'auto-completing'].includes(state.phase)) {
      return { ok: false, error: 'Nenhum lead em ligação.' };
    }
    if (live && !dialing && !thisCallId) return { ok: false, error: 'Não encontrei a ligação deste lead. Tente de novo em instantes.' };
    if (!live || (!thisCallId && !dialing)) {
      console.warn('[cockpit-auto-dial] simulado: retorno e desfecho NÃO gravados (ligar depois)');
      toast.info('Simulado: nada é registrado.');
      if (inAwaitingSdr) {
        setCallPhase('idle');
        dispatch({ type: 'sdr_concluded' });
        if (input.pauseQueueFor) pauseAndTell(input.pauseQueueFor);
      } else {
        concludeExternally(lead.leadId, externalKind); // ligação em curso: o motor deixa o lead e segue ao fim dela
        pauseWhenFree.current = input.pauseQueueFor ?? null;
      }
      return { ok: true };
    }
    // O retorno de uma indicação leva outra observação: não reaproveita o de um "Ligar depois" que ficou pela metade.
    const scheduledKey = `${thisCallId ?? `lead:${lead.leadId}`}${referred ? ':referred' : ''}`;
    if (!callbackScheduledCalls.current.has(scheduledKey)) {
      // Sem `executedStep`: o motor não avança a cadência (D6). O retorno pausa a cadência até o dia útil seguinte.
      const r = await scheduleActivity({
        leadId: lead.leadId,
        channel: 'phone',
        scheduledAt: input.scheduledAt.toISOString(),
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.contactId ? { contactId: input.contactId } : {}),
        pauseCadenceUntilReturn: true,
      }).catch(() => null);
      if (!r?.success) return { ok: false, error: r && !r.success ? r.error : 'Falha ao agendar o retorno' };
      callbackScheduledCalls.current.add(scheduledKey);
    }
    if (!inAwaitingSdr) {
      // Ligar depois com a ligação tocando, no ar ou terminando: o retorno já está agendado. O motor deixa o lead (sem nova
      // tentativa, sem `no_answer`) e só segue quando a ligação acabar; o desfecho mínimo é gravado ao fim dela.
      concludeExternally(lead.leadId, externalKind);
      pauseWhenFree.current = input.pauseQueueFor ?? null;
      return { ok: true };
    }
    const confirmed = await confirmWith({ disposition, notes: input.callNotes ?? input.notes }, false);
    if (!confirmed) {
      return {
        ok: false,
        error: 'O retorno foi agendado, mas o desfecho da ligação não foi registrado. Tente de novo: só o desfecho será reenviado.',
        ...(referred ? { retornoSaved: true } : {}),
      };
    }
    if (thisCallId) concludedCalls.current.add(thisCallId); // clique atrasado não regrava; o lead NÃO entra em `concluded` (ele volta no retorno)
    if (input.pauseQueueFor) pauseAndTell(input.pauseQueueFor); // só depois do retorno e do desfecho gravados
    return { ok: true };
  }

  const baseStatusText = describeCockpitAutoDial(state);
  const noticeVisible =
    noticeState !== null && noticeState.callId === callId && (state.phase === 'advancing' || state.phase === 'countdown' || state.phase === 'auto-completing' || state.phase === 'waiting');
  const notice = noticeVisible ? noticeState.text : null;
  const statusTextWithNotice = notice ? (baseStatusText ? `${notice} · ${baseStatusText}` : notice) : baseStatusText;

  return {
    state,
    statusText: statusTextWithNotice,
    card,
    tier,
    simulated: !live,
    callId,
    callLostLeadId: state.phase === 'paused' ? lostLeadId : null,
    attemptNo,
    start,
    stop,
    pause,
    resume: () => {
      pauseWhenFree.current = null;
      clearSessionLost();
      dispatch({ type: 'resume' });
    },
    confirmOutcome,
    concludeExternally,
    scheduleCallback,
    notConversation,
    notice,
    startError,
    leadCardExtras,
    skippedLeads,
  };
}
