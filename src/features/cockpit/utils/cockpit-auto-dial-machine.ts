import {
  describeAutoDial,
  initialAutoDialState,
  reduceAutoDial,
  type AutoDialEvent,
  type AutoDialState,
} from '@/features/activities/utils/auto-dialer';

import { AUTO_DIAL_RULES, isLastAttemptOfDay } from './auto-dial-rules';

/**
 * Máquina de estados do motor automático do Cockpit (spec §3). Redutor PURO: sem relógio, sem rede,
 * sem React. Os efeitos (timers, discar, gravar) ficam no hook (E6).
 *
 * ENVOLVE `reduceAutoDial` da Execução (só importa, nunca edita) e muda 2 coisas da spec:
 *  1. FR-8: ligação ATENDIDA pausa em `awaiting-sdr {reason:'answered'}` e espera o SDR confirmar o
 *     desfecho (a Execução segue sozinha para `auto-completing`).
 *  2. FR-11/FR-12: fase nova `blocked` (fora do horário, feriado, teto do dia, sem lead). Só sai com
 *     `stop` (Desligado) ou `start` (nova contagem).
 * O resto (contagem de 5 s, 424 com 1 nova tentativa, erro/SIP → pausa, 20 s sem sinal, Aguardando)
 * é o redutor da Execução, sem desvio.
 */

export type AutoDialBlockedReason = 'outside_hours' | 'holiday' | 'daily_cap' | 'empty';

export type CockpitAutoDialState =
  | AutoDialState
  | { phase: 'blocked'; reason: AutoDialBlockedReason }
  /** O SDR concluiu o lead pelo painel (agendou/desqualificou) com a ligação ainda no ar: o motor só segue quando ela terminar. */
  | { phase: 'concluded-call' };

export type CockpitAutoDialEvent =
  | AutoDialEvent
  | { type: 'blocked'; reason: AutoDialBlockedReason }
  /** O SDR concluiu o lead pelo painel (Agendar reunião / Desqualificar): vale como desfecho, sem pedir o Confirmar. */
  | { type: 'concluded_externally' }
  /** O SDR disse que a ligação atendida NÃO foi conversa: segue o caminho da não atendida (1ª/2ª sem gravar, 3ª grava). */
  | { type: 'not_conversation'; attemptNo: number };

/** D8 / FR-1: o motor SEMPRE começa Desligado ao carregar; nada é lembrado entre recarregamentos. */
export const initialCockpitAutoDialState: CockpitAutoDialState = initialAutoDialState;

/** Fases em que o servidor pode recusar e levar a Bloqueado (spec §3: contagem, discando, espera). */
const CAN_BLOCK: ReadonlySet<string> = new Set(['countdown', 'dialing', 'advancing', 'waiting', 'auto-completing']);

/** Ligação ainda no ar: Parar e a conclusão pelo painel NUNCA a derrubam (FR-13). */
const CALL_ON_AIR: ReadonlySet<string> = new Set(['awaiting-session', 'in-call']);
/** Ligação já terminou; o motor espera o desfecho. */
const CALL_ENDED: ReadonlySet<string> = new Set(['resolving', 'awaiting-sdr', 'auto-completing']);

export function reduceCockpitAutoDial(state: CockpitAutoDialState, event: CockpitAutoDialEvent): CockpitAutoDialState {
  // Conclusão pelo painel (Desqualificar / Agendar): o clique do SDR já é o desfecho (decisão do usuário).
  // Em ligação → espera ela terminar (sem derrubar); depois do fim → segue já. Fora disso é ignorada.
  if (event.type === 'concluded_externally') {
    if (CALL_ON_AIR.has(state.phase)) return { phase: 'concluded-call' };
    if (CALL_ENDED.has(state.phase)) return reduceAutoDial(initialAutoDialState, { type: 'start' });
    return state;
  }
  if (state.phase === 'concluded-call') {
    if (event.type === 'call_ended') return reduceAutoDial(initialAutoDialState, { type: 'start' });
    if (event.type === 'stop') return initialCockpitAutoDialState;
    return state; // eventos atrasados da ligação são ignorados
  }

  if (event.type === 'not_conversation') {
    return state.phase === 'awaiting-sdr' ? reduceAutoDial({ phase: 'resolving' }, noAnswerEvent(event.attemptNo)) : state;
  }

  if (event.type === 'blocked') return CAN_BLOCK.has(state.phase) ? { phase: 'blocked', reason: event.reason } : state;

  if (state.phase === 'blocked') {
    // Bloqueado só sai por Parar (Desligado) ou Iniciar (nova contagem).
    if (event.type === 'stop') return initialCockpitAutoDialState;
    if (event.type === 'start') return reduceAutoDial(initialAutoDialState, event);
    return state;
  }

  // FR-8: atendeu → pausa e espera o SDR confirmar (não conclui sozinho).
  if (state.phase === 'resolving' && event.type === 'lead_answer' && event.answer === 'answered') {
    return { phase: 'awaiting-sdr', reason: 'answered' };
  }

  return reduceAutoDial(state, event);
}

/**
 * FR-6/FR-7: evento de "não atendeu" conforme a tentativa do dia (`attemptNo` = ligações do lead hoje,
 * contando esta). 1ª ou 2ª: segue para o próximo lead, sem gravar nada e sem avançar cadência (o lead volta
 * após 1 h). 3ª: vai para `auto-completing(no_answer)` = sinal para gravar `no_answer`, também sem avançar cadência (D6).
 */
export function noAnswerEvent(attemptNo: number, rules: { maxAttemptsPerDay: number } = AUTO_DIAL_RULES): AutoDialEvent {
  return isLastAttemptOfDay(attemptNo, rules)
    ? { type: 'lead_answer', answer: 'not_answered' }
    : { type: 'lead_answer', answer: 'not_answered', then: 'next_lead' };
}

/** Há uma ligação (ou discagem) em curso? Parar NUNCA a derruba: o botão Desligar é separado (FR-13). */
export function isCallInProgress(state: CockpitAutoDialState): boolean {
  return (
    state.phase === 'dialing' ||
    state.phase === 'awaiting-session' ||
    state.phase === 'in-call' ||
    state.phase === 'concluded-call' ||
    state.phase === 'resolving'
  );
}

/** O motor está ligado (qualquer fase que não seja Desligado). */
export function isCockpitAutoDialOn(state: CockpitAutoDialState): boolean {
  return state.phase !== 'off';
}

const BLOCKED_TEXT: Record<AutoDialBlockedReason, string> = {
  outside_hours: 'Fora do horário (seg–sex 8h–20h): discagem bloqueada',
  holiday: 'Feriado: discagem bloqueada',
  daily_cap: 'Teto do dia atingido: discagem bloqueada',
  empty: 'Sem leads disponíveis agora: discagem parada',
};

/** Texto curto do estado para a tela; reaproveita `describeAutoDial` e cobre os textos novos. */
export function describeCockpitAutoDial(state: CockpitAutoDialState): string | null {
  if (state.phase === 'blocked') return BLOCKED_TEXT[state.reason];
  if (state.phase === 'concluded-call') return 'Lead concluído pelo painel: a discagem segue quando a ligação terminar';
  if (state.phase === 'awaiting-sdr' && state.reason === 'answered') return 'Em conversa: confirme o desfecho para seguir';
  return describeAutoDial(state);
}
