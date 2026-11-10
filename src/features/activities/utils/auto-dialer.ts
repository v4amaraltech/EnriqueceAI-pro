// Discagem automática do Power Dialer (stories power-dialer-auto-dial e
// power-dialer-rounds).
//
// Máquina de estados PURA: decide o que vem depois; os efeitos (discar,
// concluir, temporizadores) ficam no `PowerDialerTab`. Um lead por vez:
//
//   countdown(5s) → dialing → awaiting-session → in-call → resolving
//        ├─ atendeu → auto-completing(answered) → countdown
//        ├─ não atendeu, outro número livre → countdown (mesmo lead)
//        ├─ não atendeu, números em espera → advancing → countdown | waiting
//        ├─ não atendeu, última tentativa do dia → auto-completing(no_answer)
//        ├─ 20 s sem sinal → awaiting-sdr
//        ├─ POST ok sem a sessão desta aba → pausa (não conclui)
//        └─ 424 do ramal → releasing (uma espera) → dialing | pausa
//
// Rodadas (decisão do Vini, 05/11/2026): cada número do lead é discado 1x por
// rodada (nº1, nº2… e segue para o próximo lead), até `limit` vezes por número
// no dia, com pelo menos 1 h entre duas ligações para o MESMO número. A tarefa
// só é concluída como "Não atendeu" na última tentativa do dia; atendeu em
// qualquer rodada → conclui na hora (o resultado vem depois, pela IA).
//
// "resolving" espera o sinal da API4COM (webhook: answered_at / hangup_cause),
// que chega alguns segundos depois do fim da ligação no navegador.

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';

/** Contagem regressiva entre ligações (decisão do Vini, 22/10/2026). */
export const AUTO_DIAL_COUNTDOWN_SECONDS = 5;
/** Espera máxima pelo sinal da API4COM antes de devolver a decisão ao SDR. */
export const AUTO_DIAL_ANSWER_TIMEOUT_MS = 20_000;
/** Intervalo mínimo entre duas ligações para o mesmo número (05/11/2026). */
export const AUTO_DIAL_MIN_GAP_MS = 60 * 60 * 1000;

export type AutoDialPauseReason = 'user' | 'blocked' | 'dial_failed' | 'complete_failed';

/** O que fazer depois de uma ligação não atendida. */
export type NoAnswerNext = 'complete' | 'next_number' | 'next_lead';

export type AutoDialState =
  | { phase: 'off' }
  | { phase: 'countdown'; secondsLeft: number }
  | { phase: 'dialing' }
  /** POST aceito, ainda sem a sessão SIP deste dialToken nesta aba. */
  | { phase: 'awaiting-session' }
  | { phase: 'in-call' }
  | { phase: 'resolving' }
  | { phase: 'auto-completing'; outcome: 'answered' | 'no_answer' }
  /** Não atendeu e ainda há tentativas mais tarde: indo para outro lead. */
  | { phase: 'advancing' }
  /** Ninguém liberado agora (intervalo de 1 h): espera até `until` (ms). */
  | { phase: 'waiting'; until: number }
  /** 424: a chamada não nasceu e o ramal ainda pode estar ocupado. Uma espera, um novo POST. */
  | { phase: 'releasing'; until: number }
  | { phase: 'awaiting-sdr'; reason: 'answered' | 'timeout' }
  | { phase: 'paused'; reason: AutoDialPauseReason; message: string | null };

export type AutoDialEvent =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'tick' }
  | { type: 'dial_now' }
  | { type: 'dial_started' }
  | { type: 'awaiting_session' }
  | { type: 'session_confirmed' }
  | { type: 'session_missing'; message: string }
  | { type: 'ramal_busy'; until: number }
  | { type: 'ramal_retry' }
  | { type: 'dial_failed'; message: string | null }
  | { type: 'call_ended' }
  /** `then` só vale para "não atendeu"; sem ele, conclui (comportamento antigo). */
  | { type: 'lead_answer'; answer: 'answered' | 'not_answered'; then?: NoAnswerNext }
  | { type: 'answer_timeout' }
  | { type: 'completed' }
  | { type: 'complete_failed'; message: string | null }
  | { type: 'sdr_concluded' }
  /** O lead da vez mudou (Pular, seleção manual, próxima rodada): recomeça a contagem. */
  | { type: 'next_lead' }
  /** Ninguém liberado agora: aguarda até `until`. */
  | { type: 'wait'; until: number }
  /** Chegou a hora de quem estava em espera. */
  | { type: 'wake' }
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
      if (event.type === 'wait') return { phase: 'waiting', until: event.until };
      return state;
    case 'dialing':
      if (event.type === 'dial_started') return { phase: 'in-call' };
      if (event.type === 'awaiting_session') return { phase: 'awaiting-session' };
      if (event.type === 'ramal_busy') return { phase: 'releasing', until: event.until };
      if (event.type === 'dial_failed') return { phase: 'paused', reason: 'dial_failed', message: event.message };
      // Nada para discar agora (todos em espera): o efeito redireciona.
      if (event.type === 'next_lead') return countdown();
      if (event.type === 'wait') return { phase: 'waiting', until: event.until };
      return state;
    case 'awaiting-session':
      if (event.type === 'session_confirmed' || event.type === 'dial_started') return { phase: 'in-call' };
      if (event.type === 'session_missing') return { phase: 'paused', reason: 'blocked', message: event.message };
      return state;
    case 'in-call':
      return event.type === 'call_ended' ? { phase: 'resolving' } : state;
    case 'releasing':
      if (event.type === 'ramal_retry') return { phase: 'dialing' };
      return state;
    case 'resolving':
      if (event.type === 'lead_answer') {
        if (event.answer === 'answered') return { phase: 'auto-completing', outcome: 'answered' };
        if (event.then === 'next_number') return countdown();
        if (event.then === 'next_lead') return { phase: 'advancing' };
        return { phase: 'auto-completing', outcome: 'no_answer' };
      }
      if (event.type === 'answer_timeout') return { phase: 'awaiting-sdr', reason: 'timeout' };
      return state;
    case 'auto-completing':
      if (event.type === 'completed') return countdown();
      if (event.type === 'complete_failed') return { phase: 'paused', reason: 'complete_failed', message: event.message };
      return state;
    case 'advancing':
      if (event.type === 'next_lead') return countdown();
      if (event.type === 'wait') return { phase: 'waiting', until: event.until };
      return state;
    case 'waiting':
      if (event.type === 'wake' || event.type === 'dial_now' || event.type === 'next_lead') return countdown();
      if (event.type === 'wait') return { phase: 'waiting', until: event.until };
      return state;
    case 'awaiting-sdr':
      if (event.type === 'sdr_concluded' || event.type === 'next_lead') return countdown();
      if (event.type === 'wait') return { phase: 'waiting', until: event.until };
      return state;
    case 'paused':
      return event.type === 'resume' ? countdown() : state;
    default:
      return state;
  }
}

/** O discador automático está cuidando da ligação (o SDR não precisa clicar). */
export function isAutoDialRunning(state: AutoDialState): boolean {
  return (
    state.phase === 'countdown' ||
    state.phase === 'dialing' ||
    state.phase === 'awaiting-session' ||
    state.phase === 'in-call' ||
    state.phase === 'releasing' ||
    state.phase === 'resolving' ||
    state.phase === 'auto-completing' ||
    state.phase === 'advancing' ||
    state.phase === 'waiting'
  );
}

// ---------------------------------------------------------------------------
// Tentativas por número
// ---------------------------------------------------------------------------

export interface PhoneAttempt {
  /** Ligações para este número hoje (BRT). */
  count: number;
  /** Última ligação (ms desde a época); null = nenhuma hoje. */
  lastAt: number | null;
}

export type AttemptLog = ReadonlyMap<string, PhoneAttempt>;

/**
 * Chave de um número para contar tentativas: só dígitos, sem o 55 do país.
 * "(11) 999990000", "5511999990000" e "11999990000" viram a mesma chave
 * (`calls.destination` é gravado só com dígitos, com ou sem 55).
 */
export function phoneKey(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits;
}

/** Números do lead, na ordem da fila, sem repetidos. */
export function itemPhones(item: Pick<DialerQueueItem, 'phone' | 'phones'>): string[] {
  const list = item.phones.length > 0 ? item.phones.map((p) => p.formatted) : item.phone ? [item.phone] : [];
  const seen = new Set<string>();
  return list.filter((p) => {
    const k = phoneKey(p);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function attemptOf(log: AttemptLog, phone: string): PhoneAttempt {
  return log.get(phoneKey(phone)) ?? { count: 0, lastAt: null };
}

/** Números que podem ser discados AGORA (abaixo do limite e fora do intervalo). */
export function availablePhones(item: Pick<DialerQueueItem, 'phone' | 'phones'>, log: AttemptLog, limit: number, now: number): string[] {
  return itemPhones(item).filter((p) => {
    const a = attemptOf(log, p);
    return a.count < limit && (a.lastAt === null || now - a.lastAt >= AUTO_DIAL_MIN_GAP_MS);
  });
}

/** Todos os números já usaram as tentativas do dia. */
export function isExhausted(item: Pick<DialerQueueItem, 'phone' | 'phones'>, log: AttemptLog, limit: number): boolean {
  return itemPhones(item).every((p) => attemptOf(log, p).count >= limit);
}

/** Quando o próximo número do lead fica liberado (null = esgotado). */
export function nextAvailableAt(item: Pick<DialerQueueItem, 'phone' | 'phones'>, log: AttemptLog, limit: number): number | null {
  let best: number | null = null;
  for (const p of itemPhones(item)) {
    const a = attemptOf(log, p);
    if (a.count >= limit) continue;
    const at = a.lastAt === null ? 0 : a.lastAt + AUTO_DIAL_MIN_GAP_MS;
    if (best === null || at < best) best = at;
  }
  return best;
}

/** Registra uma ligação para `phone` em `now` (devolve um log novo). */
export function recordAttempt(log: AttemptLog, phone: string, now: number): Map<string, PhoneAttempt> {
  const next = new Map(log);
  const k = phoneKey(phone);
  const a = log.get(k) ?? { count: 0, lastAt: null };
  next.set(k, { count: a.count + 1, lastAt: now });
  return next;
}

/** Ligações de hoje agrupadas por número (`calls.destination`). */
export function countCallsByPhone(
  rows: ReadonlyArray<{ destination: string | null; started_at: string | null }>,
): Map<string, { count: number; last: string | null }> {
  const byPhone = new Map<string, { count: number; last: string | null }>();
  for (const c of rows) {
    const key = phoneKey(c.destination);
    if (!key) continue;
    const cur = byPhone.get(key) ?? { count: 0, last: null };
    const last = !cur.last || (c.started_at && c.started_at > cur.last) ? c.started_at : cur.last;
    byPhone.set(key, { count: cur.count + 1, last });
  }
  return byPhone;
}

/** Log inicial a partir da contagem do servidor (ligações de hoje por número). */
export function buildAttemptLog(queue: readonly DialerQueueItem[]): Map<string, PhoneAttempt> {
  const log = new Map<string, PhoneAttempt>();
  for (const item of queue) {
    for (const a of item.phoneAttempts ?? []) {
      const k = phoneKey(a.phone);
      if (!k || log.has(k)) continue;
      log.set(k, { count: a.attemptsToday, lastAt: a.lastAttemptAt ? Date.parse(a.lastAttemptAt) : null });
    }
  }
  return log;
}

/** Depois de "não atendeu" (a tentativa já registrada no log). */
export function decideAfterNoAnswer(
  item: Pick<DialerQueueItem, 'phone' | 'phones'>,
  log: AttemptLog,
  limit: number,
  now: number,
): NoAnswerNext {
  if (availablePhones(item, log, limit, now).length > 0) return 'next_number';
  if (isExhausted(item, log, limit)) return 'complete';
  return 'next_lead';
}

/**
 * Pode ser discado no automático: ainda não feito/pulado, tem telefone e está
 * NA etapa de ligação. Os demais (etapa atual é outra) só no modo manual —
 * concluir pularia as etapas do meio da cadência.
 */
export function isAutoDialEligible(item: DialerQueueItem, done: ReadonlySet<string>): boolean {
  return !done.has(item.enrollmentId) && !!item.phone && item.currentStepIsPhone;
}

export type AutoDialPick = { kind: 'dial'; index: number } | { kind: 'wait'; index: number; until: number } | { kind: 'none' };

/**
 * Próximo lead do automático depois de `fromIndex`, dando a volta na fila
 * (rodadas): o primeiro com número liberado agora; senão, o que fica liberado
 * mais cedo (espera); senão, acabou.
 */
export function pickNextAutoDial(
  queue: readonly DialerQueueItem[],
  fromIndex: number,
  done: ReadonlySet<string>,
  log: AttemptLog,
  limit: number,
  now: number,
): AutoDialPick {
  const n = queue.length;
  let wait: { index: number; until: number } | null = null;
  for (let step = 1; step <= n; step++) {
    const i = (((fromIndex + step) % n) + n) % n;
    const item = queue[i];
    if (!item || !isAutoDialEligible(item, done)) continue;
    if (availablePhones(item, log, limit, now).length > 0) return { kind: 'dial', index: i };
    const at = nextAvailableAt(item, log, limit);
    if (at !== null && (wait === null || at < wait.until)) wait = { index: i, until: at };
  }
  return wait ? { kind: 'wait', ...wait } : { kind: 'none' };
}

/** Hora "HH:MM" em Brasília. */
function brtTime(ms: number): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(ms);
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
    case 'awaiting-session':
      return 'Aguardando o webphone desta aba…';
    case 'in-call':
      return 'Em ligação';
    case 'releasing':
      return 'O ramal ainda está ocupado na operadora. A próxima tentativa espera a liberação.';
    case 'resolving':
      return 'Conferindo se o lead atendeu…';
    case 'auto-completing':
      return state.outcome === 'answered'
        ? 'Atendida — registrando (a IA anota o resultado) e seguindo'
        : 'Não atendeu (última tentativa do dia) — registrando e seguindo';
    case 'advancing':
      return 'Não atendeu — tenta de novo mais tarde; indo para o próximo lead';
    case 'waiting':
      return `Aguardando: próxima ligação liberada às ${brtTime(state.until)}`;
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
