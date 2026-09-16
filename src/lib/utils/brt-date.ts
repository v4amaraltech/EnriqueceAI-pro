/**
 * BRT timezone helpers. The app's stats pages treat date inputs as Brazilian
 * (UTC-3 year-round, no DST since 2019), but a `YYYY-MM-DD` string passed
 * directly to a Postgres `timestamptz` comparison is interpreted as UTC
 * midnight — that's 21:00 BRT of the *previous* day, so 3 hours of activity
 * leak into the wrong window. Use these helpers when converting a date input
 * to an ISO cutoff for `.gte` / `.lte` filters.
 */

const BRT_OFFSET_HOURS = 3;
const BRT_OFFSET_MS = BRT_OFFSET_HOURS * 60 * 60 * 1000;

/**
 * Today's calendar date in BRT as `YYYY-MM-DD`.
 *
 * `new Date()` reads the server clock in UTC, so after 21:00 BRT it already
 * reports the next calendar day. Daily counters/limits keyed on the raw UTC
 * date (`new Date().toISOString().slice(0,10)`) therefore roll over 3h early.
 * Shift the instant -3h before extracting the day.
 */
export function brtTodayIso(): string {
  return brtDateIso(new Date());
}

/**
 * Calendar date (`YYYY-MM-DD`) of an instant in BRT. Shifts the instant -3h
 * and reads the UTC day, so it never depends on the process/browser timezone.
 */
export function brtDateIso(date: Date): string {
  return new Date(date.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Adds `days` (may be negative) to a `YYYY-MM-DD` string, calendar-wise.
 * `2026-03-01` + (-1) → `2026-02-28`.
 */
export function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * "Start of BRT day" for a `YYYY-MM-DD` input, expressed as ISO UTC.
 * `2026-05-01` → `2026-05-01T03:00:00.000Z` (00:00 BRT).
 */
export function brtDayStartIso(dateStr: string): string {
  return new Date(`${dateStr}T${String(BRT_OFFSET_HOURS).padStart(2, '0')}:00:00.000Z`).toISOString();
}

/**
 * "End of BRT day" for a `YYYY-MM-DD` input, expressed as ISO UTC.
 * `2026-05-01` → `2026-05-02T02:59:59.999Z` (23:59:59.999 BRT).
 */
export function brtDayEndIso(dateStr: string): string {
  const next = new Date(`${dateStr}T${String(BRT_OFFSET_HOURS).padStart(2, '0')}:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCMilliseconds(-1);
  return next.toISOString();
}

/**
 * Interpreta uma data/hora "de parede" em BRT (UTC-3) e devolve o instante UTC.
 *
 * Aceita `YYYY-MM-DDTHH:MM` ou `...:SS` SEM fuso (ex.: `metadata.start_time` de
 * reuniões, `"2026-08-03T14:00:00"`). `new Date()` sobre uma string naive assume
 * o fuso do SERVIDOR (UTC em produção), jogando o horário 3h pra frente — uma
 * reunião de 14:00 BRT viraria 14:00 UTC (= 11:00 BRT), fazendo lembretes
 * dispararem cedo. Ancorando em `-03:00` o instante fica correto (17:00 UTC).
 * Retorna `null` para entradas inválidas.
 */
export function parseBrtDateTime(naive: string): Date | null {
  const m = naive.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
