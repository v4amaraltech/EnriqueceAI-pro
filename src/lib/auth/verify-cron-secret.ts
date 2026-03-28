import crypto from 'crypto';

/**
 * Timing-safe verification of the CRON_SECRET Bearer token.
 * Extracts the token from the Authorization header and compares
 * against the CRON_SECRET environment variable.
 */
export function verifyCronSecret(request: Request): boolean {
  const authHeader = request.headers.get('authorization') ?? '';
  const expectedToken = process.env.CRON_SECRET;
  if (!expectedToken) return false;
  const expected = `Bearer ${expectedToken}`;
  try {
    return (
      Buffer.byteLength(authHeader) === Buffer.byteLength(expected) &&
      crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
    );
  } catch {
    return false;
  }
}
