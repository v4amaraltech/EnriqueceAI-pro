/**
 * Compute the BRL cost of a call from its destination number and duration.
 *
 * API4COM bills mobile and landline at very different rates (~R$0.37/min
 * mobile vs ~R$0.08/min landline as of 2026-05), so the per-minute rate
 * depends on the dialed number. We detect the kind from the destination,
 * round duration up to the next full minute (carriers bill that way), and
 * apply the rate read from env.
 *
 * Returns `null` when:
 *  - the relevant env var is unset (lets the column stay NULL instead of
 *    writing wrong/zero values until ops sets the rate)
 *  - duration is zero / non-positive (no answered call to bill)
 *  - the destination doesn't look like a Brazilian phone number we can
 *    classify (defensively skips billing)
 */
export type DialedKind = 'mobile' | 'landline' | 'unknown';

export function classifyDialedNumber(raw: string | null | undefined): DialedKind {
  if (!raw) return 'unknown';
  const digits = raw.replace(/\D/g, '');
  // Brazilian numbers from API4COM come as 55 (country) + DDD (2) + subscriber.
  // Mobile = 11 subscriber digits starting with 9. Landline = 10 with first 2-5.
  // Some payloads omit the 55 country prefix; handle both shapes.
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11) {
    return local.charAt(2) === '9' ? 'mobile' : 'unknown';
  }
  if (local.length === 10) {
    const firstSubscriber = local.charAt(2);
    return ['2', '3', '4', '5'].includes(firstSubscriber) ? 'landline' : 'unknown';
  }
  return 'unknown';
}

export function computeCallCostBrl(
  durationSeconds: number | null | undefined,
  destination: string | null | undefined,
): number | null {
  if (!durationSeconds || durationSeconds <= 0) return null;

  const kind = classifyDialedNumber(destination);
  if (kind === 'unknown') return null;

  const envKey =
    kind === 'mobile' ? 'API4COM_PRICE_PER_MIN_MOBILE_BRL' : 'API4COM_PRICE_PER_MIN_LANDLINE_BRL';
  const raw = process.env[envKey];
  if (!raw) return null;
  const pricePerMin = Number(raw);
  if (!Number.isFinite(pricePerMin) || pricePerMin <= 0) return null;

  const billedMinutes = Math.ceil(durationSeconds / 60);
  return Math.round(billedMinutes * pricePerMin * 100) / 100;
}
