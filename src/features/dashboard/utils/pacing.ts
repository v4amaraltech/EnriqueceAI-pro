/**
 * Goal pacing on BUSINESS DAYS (Mon–Fri, BRT calendar, minus national holidays)
 * instead of calendar days.
 *
 * SDRs don't open leads, book meetings or run activities on weekends or holidays,
 * so a linear calendar-day pace ("esperado até hoje") inflated the expectation
 * every Saturday/Sunday/feriado even though nobody was working — making the team
 * look behind the goal when they weren't. We pace on working days instead: the
 * "expected" line only rises on business days and stays flat across weekends and
 * Brazilian national holidays (see `holidays-br.ts`).
 *
 * Shared by every goal-paced card on the dashboard (Leads abertos, Reuniões
 * marcadas, Reuniões realizadas, the ranking percentOfTarget and the per-SDR
 * "ideal até hoje") so sibling cards never disagree on what "no ritmo" means.
 *
 * BRT is fixed UTC-3 (no DST since 2019), so day-of-week is derived from the
 * UTC calendar date directly — no timezone library needed.
 */
import { isHolidayBr } from './holidays-br';

/**
 * Count of weekdays (Mon–Fri, BRT) in the inclusive range [start, end]. Use this
 * to pace a metric over an arbitrary period (not a whole calendar month) — e.g.
 * a statistics filter range. Returns at least 1 so it is safe as a divisor.
 *
 * BRT is fixed UTC-3: shift each instant by -3h to land on its BRT calendar day,
 * truncate to day granularity, then walk day-by-day counting non-weekend days.
 */
export function businessDaysBetween(start: Date | string | number, end: Date | string | number): number {
  const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
  const DAY_MS = 86_400_000;
  const startMs = (start instanceof Date ? start : new Date(start)).getTime() - BRT_OFFSET_MS;
  const endMs = (end instanceof Date ? end : new Date(end)).getTime() - BRT_OFFSET_MS;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 1;
  const firstDay = Math.floor(startMs / DAY_MS);
  const lastDay = Math.floor(endMs / DAY_MS);
  let count = 0;
  for (let d = firstDay; d <= lastDay; d++) {
    const dt = new Date(d * DAY_MS);
    const dow = dt.getUTCDay();
    if (dow !== 0 && dow !== 6 && !isHolidayBr(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())) {
      count++;
    }
  }
  return count || 1;
}

/** Count of working days (Mon–Fri, minus holidays) from day 1 through `throughDay` (inclusive). */
export function businessDaysThrough(year: number, month1: number, throughDay: number): number {
  let count = 0;
  for (let d = 1; d <= throughDay; d++) {
    const dow = new Date(Date.UTC(year, month1 - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6 && !isHolidayBr(year, month1, d)) count++;
  }
  return count;
}

/** Total working days (Mon–Fri, minus holidays) in the whole month. */
export function businessDaysInMonth(year: number, month1: number): number {
  const daysInMonth = new Date(year, month1, 0).getDate();
  return businessDaysThrough(year, month1, daysInMonth);
}

/**
 * Linear goal pace on business days: the slice of `target` that should already
 * be done by the end of `throughDay`. Returns 0 when target <= 0 or the month
 * has no business days. For a fully elapsed month (throughDay = last day) this
 * returns the full target, matching the previous calendar-day behaviour.
 */
export function expectedByBusinessDay(
  target: number,
  year: number,
  month1: number,
  throughDay: number,
): number {
  if (target <= 0) return 0;
  const total = businessDaysInMonth(year, month1);
  if (total <= 0) return 0;
  const elapsed = businessDaysThrough(year, month1, throughDay);
  return (target / total) * elapsed;
}
