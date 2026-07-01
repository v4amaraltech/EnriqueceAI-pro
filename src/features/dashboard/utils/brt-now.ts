/**
 * "Now" in BRT (fixed UTC-3, no DST since 2019) for dashboard period defaults.
 *
 * `new Date()` reads the process/browser clock in UTC on the server. At 21:00 BRT
 * the UTC clock is already 00:00 the next day, so on the last day of a month the
 * default period rolled forward a day early — e.g. at 23:00 BRT on 30/jun the
 * dashboard defaulted to an empty "Julho", making every card read 0.
 *
 * Shifting the instant by -3h lands it on the correct BRT calendar day, from which
 * year/month/day are read. Same fixed-offset convention as `pacing.ts`.
 */

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Current calendar date in BRT as `{ year, month1 (1-12), day }`. */
export function brtNowParts(): { year: number; month1: number; day: number } {
  const brt = new Date(Date.now() - BRT_OFFSET_MS);
  return { year: brt.getUTCFullYear(), month1: brt.getUTCMonth() + 1, day: brt.getUTCDate() };
}

/** Current month in BRT as a `"YYYY-MM"` string — the dashboard period default. */
export function currentMonthBrt(): string {
  const { year, month1 } = brtNowParts();
  return `${year}-${String(month1).padStart(2, '0')}`;
}

/**
 * The "current day" to pace a month-based card against: today's day-of-month when
 * `month` ("YYYY-MM") is the current BRT month, otherwise the month's last day
 * (a past month is fully elapsed). Keeps sibling cards from disagreeing on pace.
 */
export function currentDayOfMonthBrt(month: string): number {
  const [yr, mo] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(yr, mo, 0).getDate();
  const now = brtNowParts();
  const isCurrent = now.year === yr && now.month1 === mo;
  return isCurrent ? now.day : lastDay;
}
