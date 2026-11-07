/**
 * Regras de ritmo do WhatsApp automático (story whatsapp-evolution-paced-sending).
 *
 * Funções puras — o cron só lê o estado do banco, pergunta aqui e grava o
 * resultado. Tudo que envolve hora recebe `now` de fora para ser testável com
 * relógio fixo.
 */
import { brtDateKey, isBrBusinessDay } from '@/lib/utils/br-holidays';

/** Limite diário de contatos novos de um número novo. */
export const START_DAILY_LIMIT = 20;
/** Quanto o limite sobe (e desce num incidente) por degrau. */
export const DAILY_LIMIT_STEP = 10;
/** Teto do aquecimento. */
export const MAX_DAILY_LIMIT = 80;
/** Dias úteis sem incidente para subir um degrau. */
export const BUSINESS_DAYS_PER_RAISE = 3;

/** Intervalo aleatório entre dois envios do mesmo número. */
export const MIN_INTERVAL_MS = 2 * 60_000;
export const MAX_INTERVAL_MS = 6 * 60_000;

/** "Digitando…" antes da mensagem (campo `delay` da Evolution v2). */
export const MIN_TYPING_MS = 3_000;
export const MAX_TYPING_MS = 8_000;

/** Janela de envio em BRT: [8h, 18h). */
export const WINDOW_START_HOUR = 8;
export const WINDOW_END_HOUR = 18;

/** Mensagens de WhatsApp sem resposta por lead antes de parar de enviar. */
export const MAX_UNANSWERED = 3;

/** Freio: falhas seguidas no mesmo número. */
export const MAX_CONSECUTIVE_FAILURES = 3;
/** Freio: fração de números inválidos no dia (só com amostra mínima). */
export const MAX_INVALID_RATE = 0.2;
export const MIN_ATTEMPTS_FOR_INVALID_RATE = 5;

/** Tentativas de envio de um item antes de virar tarefa manual. */
export const MAX_ITEM_ATTEMPTS = 3;

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Hora (0–23) no horário de Brasília. BRT não tem horário de verão desde 2019. */
export function brtHour(now: Date): number {
  return new Date(now.getTime() - BRT_OFFSET_MS).getUTCHours();
}

/** Início do dia BRT de `now`, em ISO (UTC) — base para contar os envios de hoje. */
export function brtDayStartIso(now: Date): string {
  return new Date(`${brtDateKey(now)}T00:00:00-03:00`).toISOString();
}

/** Dentro da janela de envio: dia útil (sem fim de semana e feriado nacional) e 8h–18h BRT. */
export function isInSendWindow(now: Date): boolean {
  const hour = brtHour(now);
  return isBrBusinessDay(brtDateKey(now)) && hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

/** Quantos dias úteis existem DEPOIS de `fromKey` até `toKey` (inclusive). */
export function businessDaysAfter(fromKey: string, toKey: string): number {
  if (toKey <= fromKey) return 0;
  let count = 0;
  const cursor = new Date(`${fromKey}T12:00:00Z`);
  const end = new Date(`${toKey}T12:00:00Z`);
  // Teto de segurança: datas absurdas não travam o cron.
  for (let i = 0; i < 400 && cursor < end; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isBrBusinessDay(cursor.toISOString().slice(0, 10))) count++;
  }
  return count;
}

export interface DailyLimitState {
  limit: number;
  /** Dia (YYYY-MM-DD, BRT) da última mudança de limite; null = nunca. */
  changedOn: string | null;
}

/**
 * Aquecimento: a cada 3 dias úteis desde a última mudança (sem incidente — um
 * incidente também é uma mudança), o limite sobe +10 até 80. Número que nunca
 * passou por aqui começa a contar hoje.
 */
export function warmUpDailyLimit(state: DailyLimitState, todayKey: string): DailyLimitState & { changed: boolean } {
  if (state.changedOn === null) {
    return { limit: state.limit, changedOn: todayKey, changed: true };
  }
  if (state.limit >= MAX_DAILY_LIMIT) {
    return { ...state, changed: false };
  }
  if (businessDaysAfter(state.changedOn, todayKey) >= BUSINESS_DAYS_PER_RAISE) {
    return {
      limit: Math.min(MAX_DAILY_LIMIT, state.limit + DAILY_LIMIT_STEP),
      changedOn: todayKey,
      changed: true,
    };
  }
  return { ...state, changed: false };
}

/** Incidente (freio acionado): volta um degrau, nunca abaixo do inicial. */
export function limitAfterIncident(limit: number): number {
  return Math.max(START_DAILY_LIMIT, limit - DAILY_LIMIT_STEP);
}

/** Intervalo até o próximo envio do número: aleatório entre 2 e 6 min. */
export function nextIntervalMs(random: () => number = Math.random): number {
  return Math.round(MIN_INTERVAL_MS + random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS));
}

/** Duração do "digitando…": aleatória entre 3 e 8 s. */
export function typingDelayMs(random: () => number = Math.random): number {
  return Math.round(MIN_TYPING_MS + random() * (MAX_TYPING_MS - MIN_TYPING_MS));
}

export type BlockReason = 'outside_window' | 'paused' | 'interval' | 'daily_limit';

export interface CanSendInput {
  now: Date;
  pausedAt: string | null;
  nextAt: string | null;
  /** Envios de hoje que contam no limite (contatos novos). */
  sentTodayCounted: number;
  dailyLimit: number;
  /** O próximo item conta no limite? (falso = lead que já respondeu no WhatsApp). */
  countsTowardLimit: boolean;
}

/** O número pode enviar o próximo item agora? */
export function canSendNow(input: CanSendInput): { ok: true } | { ok: false; reason: BlockReason } {
  if (!isInSendWindow(input.now)) return { ok: false, reason: 'outside_window' };
  if (input.pausedAt) return { ok: false, reason: 'paused' };
  if (input.nextAt && new Date(input.nextAt).getTime() > input.now.getTime()) {
    return { ok: false, reason: 'interval' };
  }
  if (input.countsTowardLimit && input.sentTodayCounted >= input.dailyLimit) {
    return { ok: false, reason: 'daily_limit' };
  }
  return { ok: true };
}

/** Freio por números inválidos: mais de 20% do dia, com pelo menos 5 tentativas. */
export function invalidRateTripped(attemptsToday: number, invalidToday: number): boolean {
  if (attemptsToday < MIN_ATTEMPTS_FOR_INVALID_RATE) return false;
  return invalidToday / attemptsToday > MAX_INVALID_RATE;
}

/** Erro da Evolution que significa "este destino não tem WhatsApp". */
export function isInvalidNumberError(error: string | undefined): boolean {
  if (!error) return false;
  return /não está cadastrado no whatsapp|número de telefone inválido/i.test(error);
}

/** Remove {{variáveis}} que sobraram após renderizar o template (mesma regra do motor de e-mail). */
export function stripUnresolvedVars(text: string): string {
  return text
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
