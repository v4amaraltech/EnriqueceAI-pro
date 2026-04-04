import crypto from 'crypto';

/**
 * Timing-safe verification of the SUPABASE_SERVICE_ROLE_KEY Bearer token.
 * Used by worker and admin API routes.
 */
export function verifyServiceRole(request: Request): boolean {
  const authHeader = request.headers.get('authorization') ?? '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return false;
  const expected = `Bearer ${serviceRoleKey}`;
  try {
    return (
      Buffer.byteLength(authHeader) === Buffer.byteLength(expected) &&
      crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
    );
  } catch {
    return false;
  }
}
