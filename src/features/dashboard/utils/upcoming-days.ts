/**
 * Datas do bloco "Reuniões futuras" — calendário BRT (UTC-3 fixo, sem horário
 * de verão desde 2019; mesma convenção de `brt-now.ts`). Datas trafegam como
 * `YYYY-MM-DD` e a conta é feita em UTC meia-noite, então nunca escorrega de dia
 * pelo fuso do navegador.
 */

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'] as const;

/** Quantos dias o bloco mostra por vez (decisão do Vini, 08/nov: 3 dias corridos). */
export const UPCOMING_WINDOW_DAYS = 3;

function toUtcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Hoje no calendário BRT, `YYYY-MM-DD`. */
export function todayBrt(now: number = Date.now()): string {
  return fmt(new Date(now - BRT_OFFSET_MS));
}

/** `date` + `n` dias corridos (n pode ser negativo). */
export function addDays(date: string, n: number): string {
  const d = toUtcMidnight(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

/** As `count` datas a partir de `start` (inclusive). */
export function windowDates(start: string, count: number = UPCOMING_WINDOW_DAYS): string[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

/** Instante UTC em que começa o dia BRT `date` (00:00 BRT = 03:00Z). */
export function brtDayStartIso(date: string): string {
  return new Date(toUtcMidnight(date).getTime() + BRT_OFFSET_MS).toISOString();
}

/** Dia BRT (`YYYY-MM-DD`) de um instante ISO. */
export function brtDateOf(iso: string): string {
  return fmt(new Date(new Date(iso).getTime() - BRT_OFFSET_MS));
}

/** `08/11` */
export function shortDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** `DOM 08/11` */
export function weekdayLabel(date: string): string {
  return `${WEEKDAYS[toUtcMidnight(date).getUTCDay()] ?? ''} ${shortDate(date)}`;
}
