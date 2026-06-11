import crypto from 'crypto';

/**
 * Timing-safe verification of the CRON_SECRET Bearer token.
 *
 * CRON_SECRET may hold a COMMA-SEPARATED list of accepted tokens. This enables
 * zero-downtime secret rotation: set CRON_SECRET="old,new", flip every caller
 * (pg_cron jobs) to the new value, then drop the old one — no request is ever
 * rejected mid-rotation. A single value (no comma) behaves exactly as before.
 */
export function verifyCronSecret(request: Request): boolean {
  const authHeader = request.headers.get('authorization') ?? '';
  const tokens = (process.env.CRON_SECRET ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return false;

  const authBuf = Buffer.from(authHeader);
  let matched = false;
  for (const token of tokens) {
    const expected = Buffer.from(`Bearer ${token}`);
    try {
      // Guard length before timingSafeEqual (it throws on mismatched lengths).
      // No early break: compare against every candidate to keep timing uniform.
      if (authBuf.length === expected.length && crypto.timingSafeEqual(authBuf, expected)) {
        matched = true;
      }
    } catch {
      // ignore and keep checking remaining tokens
    }
  }
  return matched;
}
