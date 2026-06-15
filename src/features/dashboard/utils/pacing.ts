/**
 * Goal pacing on BUSINESS DAYS (Mon–Fri, BRT calendar) instead of calendar days.
 *
 * SDRs don't open leads, book meetings or run activities on weekends, so a
 * linear calendar-day pace ("esperado até hoje") inflated the expectation every
 * Saturday/Sunday even though nobody was working — making the team look behind
 * the goal when they weren't. We pace on weekdays instead: the "expected" line
 * only rises on business days and stays flat across weekends.
 *
 * Shared by every goal-paced card on the dashboard (Leads abertos, Reuniões
 * marcadas, Reuniões realizadas, and the ranking percentOfTarget) so sibling
 * cards never disagree on what "no ritmo" means.
 *
 * BRT is fixed UTC-3 (no DST since 2019), so day-of-week is derived from the
 * UTC calendar date directly — no timezone library needed.
 */

/** Count of weekdays (Mon–Fri) from day 1 through `throughDay` (inclusive). */
export function businessDaysThrough(year: number, month1: number, throughDay: number): number {
  let count = 0;
  for (let d = 1; d <= throughDay; d++) {
    const dow = new Date(Date.UTC(year, month1 - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** Total weekdays (Mon–Fri) in the whole month. */
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
