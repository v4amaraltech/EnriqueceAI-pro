/**
 * Plan-limit helpers. The `plans` table uses `-1` to mean "no cap"
 * (e.g. Enterprise.max_ai_per_day, Internal.*). Consumers must short-circuit
 * before any arithmetic or comparison — a raw `>=` or subtraction with `-1`
 * silently treats unlimited as a tiny limit and breaks every flow.
 */

export const UNLIMITED = -1;

export function isUnlimited(value: number | null | undefined): boolean {
  return value === UNLIMITED;
}

/** Returns true when adding {amount} to {current} would exceed {limit}. */
export function exceedsLimit(current: number, amount: number, limit: number): boolean {
  if (isUnlimited(limit)) return false;
  return current + amount > limit;
}

/** Number of remaining slots, or Infinity for unlimited plans. */
export function remainingSlots(current: number, limit: number): number {
  if (isUnlimited(limit)) return Infinity;
  return Math.max(0, limit - current);
}

/** Display helper: "Ilimitado" or the localized number. */
export function formatLimit(value: number, locale = 'pt-BR'): string {
  if (isUnlimited(value)) return 'Ilimitado';
  return value.toLocaleString(locale);
}
