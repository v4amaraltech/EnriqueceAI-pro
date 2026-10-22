// Discagem automática do Power Dialer (story power-dialer-auto-dial).
//
// Máquina de estados PURA: decide o que vem depois; os efeitos (discar,
// concluir, temporizadores) ficam no `PowerDialerTab`. Um lead por vez:
//
//   countdown(5s) → dialing → in-call → resolving ─┬─ não atendeu → auto-completing → countdown
//                                                  ├─ atendeu     → awaiting-sdr → (Concluir) → countdown
//                                                  └─ 20 s sem sinal → awaiting-sdr
//
// "resolving" espera o sinal da API4COM (webhook: answered_at / hangup_cause),
// que chega alguns segundos depois do fim da ligação no navegador.

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';

/** Contagem regressiva entre ligações (decisão do Vini, 22/10/2026). */
export const AUTO_DIAL_COUNTDOWN_SECONDS = 5;
/** Espera máxima pelo sinal da API4COM antes de devolver a decisão ao SDR. */
export const AUTO_DIAL_ANSWER_TIMEOUT_MS = 20_000;

export type AutoDialPauseReason = 'user' | 'blocked' | 'dial_failed' | 'complete_failed';

export type AutoDialState =
  | { phase: 'off' }
  | { phase: 'countdown'; secondsLeft: number }
  | { phase: 'dialing' }
  | { phase: 'in-call' }
  | { phase: 'resolving' }
  | { phase: 'auto-completing' }
  | { phase: 'awaiting-sdr'; reason: 'answered' | 'timeout' }
  | { phase: 'paused'; reason: AutoDialPauseReason; message: string | null };

export type AutoDialEvent =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'tick' }
  | { type: 'dial_now' }
  | { type: 'dial_started' }
  | { type: 'dial_failed'; message: string | null }
  | { type: 'call_ended' }
  | { type: 'lead_answer'; answer: 'answered' | 'not_answered' }
  | { type: 'answer_timeout' }
  | { type: 'completed' }
  | { type: 'complete_failed'; message: string | null }
  | { type: 'sdr_concluded' }
  /** O lead da vez mudou (Pular, seleção manual): recomeça a contagem. */
  | { type: 'next_lead' }
  | { type: 'pause'; reason: AutoDialPauseReason; message?: string | null }
  | { type: 'resume' };

export const initialAutoDialState: AutoDialState = { phase: 'off' };

const countdown = (): AutoDialState => ({ phase: 'countdown', secondsLeft: AUTO_DIAL_COUNTDOWN_SECONDS });

export function reduceAutoDial(state: AutoDialState, event: AutoDialEvent): AutoDialState {
  if (event.type === 'stop') return state.phase === 'off' ? state : initialAutoDialState;
  if (state.phase === 'off') return event.type === 'start' ? countdown() : state;
  if (event.type === 'pause') {
    if (state.phase === 'paused') return state;
    return { phase: 'paused', reason: event.reason, message: event.message ?? null };
  }

  switch (state.phase) {
    case 'countdown':
      if (event.type === 'tick') {
        return state.secondsLeft <= 1 ? { phase: 'dialing' } : { phase: 'countdown', secondsLeft: state.secondsLeft - 1 };
      }
      if (event.type === 'dial_now') return { phase: 'dialing' };
      if (event.type === 'next_lead') return countdown();
      return state;
    case 'dialing':
      if (event.type === 'dial_started') return { phase: 'in-call' };
      if (event.type === 'dial_failed') return { phase: 'paused', reason: 'dial_failed', message: event.message };
      return state;
    case 'in-call':
      return event.type === 'call_ended' ? { phase: 'resolving' } : state;
    case 'resolving':
      if (event.type === 'lead_answer') {
        return event.answer === 'not_answered' ? { phase: 'auto-completing' } : { phase: 'awaiting-sdr', reason: 'answered' };
      }
      if (event.type === 'answer_timeout') return { phase: 'awaiting-sdr', reason: 'timeout' };
      return state;
    case 'auto-completing':
      if (event.type === 'completed') return countdown();
      if (event.type === 'complete_failed') return { phase: 'paused', reason: 'complete_failed', message: event.message };
      return state;
    case 'awaiting-sdr':
      if (event.type === 'sdr_concluded' || event.type === 'next_lead') return countdown();
      return state;
    case 'paused':
      return event.type === 'resume' ? countdown() : state;
    default:
      return state;
  }
}

/** O discador automático está cuidando da ligação (o SDR não precisa clicar). */
export function isAutoDialRunning(state: AutoDialState): boolean {
  return state.phase === 'countdown' || state.phase === 'dialing' || state.phase === 'in-call' || state.phase === 'resolving' || state.phase === 'auto-completing';
}

/**
 * Pode ser discado no automático: ainda não feito/pulado, tem telefone e está
 * NA etapa de ligação. Os demais (etapa atual é outra) só no modo manual —
 * concluir pularia as etapas do meio da cadência.
 */
export function isAutoDialEligible(item: DialerQueueItem, done: ReadonlySet<string>): boolean {
  return !done.has(item.enrollmentId) && !!item.phone && item.currentStepIsPhone;
}

/** Próximo índice elegível depois de `fromIndex` (-1 se a fila acabou). */
export function findNextAutoDialIndex(queue: readonly DialerQueueItem[], fromIndex: number, done: ReadonlySet<string>): number {
  for (let i = fromIndex + 1; i < queue.length; i++) {
    const item = queue[i];
    if (item && isAutoDialEligible(item, done)) return i;
  }
  return -1;
}

/** Texto curto do estado para a tela. */
export function describeAutoDial(state: AutoDialState): string | null {
  switch (state.phase) {
    case 'off':
      return null;
    case 'countdown':
      return `Próxima ligação em ${state.secondsLeft} s`;
    case 'dialing':
      return 'Discando…';
    case 'in-call':
      return 'Em ligação';
    case 'resolving':
      return 'Conferindo se o lead atendeu…';
    case 'auto-completing':
      return 'Não atendeu — registrando e seguindo';
    case 'awaiting-sdr':
      return state.reason === 'answered'
        ? 'O lead atendeu — conclua para seguir'
        : 'Sem retorno da API4COM — conclua para seguir';
    case 'paused':
      if (state.reason === 'user') return 'Discagem automática pausada';
      return state.message ? `Pausada: ${state.message}` : 'Discagem automática pausada';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Preferência por pessoa (navegador): ligar a discagem automática
// ---------------------------------------------------------------------------

export const AUTO_DIAL_STORAGE_KEY = 'enriqueceai.power-dialer.auto.v1';

/** Lê a escolha salva; qualquer falha (aba privada, storage bloqueado) = desligado. */
export function loadAutoDialPreference(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try {
    return storage?.getItem(AUTO_DIAL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveAutoDialPreference(storage: Pick<Storage, 'setItem'> | null | undefined, enabled: boolean): void {
  try {
    storage?.setItem(AUTO_DIAL_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* sem storage: a escolha vale só nesta visita */
  }
}
