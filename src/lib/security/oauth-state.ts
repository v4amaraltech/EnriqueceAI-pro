import { cookies } from 'next/headers';
import crypto from 'crypto';

const COOKIE_NAME = 'crm_oauth_state';
const COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 min — long enough for slow OAuth flows

/**
 * Generate a random OAuth state token and persist it as an HttpOnly cookie.
 * The same token is then forwarded as the `state` query parameter to the
 * OAuth provider, and the callback validates that the cookie matches what
 * came back. This is the canonical CSRF defense for OAuth handshakes; the
 * Kommo Marketplace review process specifically checks for it.
 *
 * The cookie is bound to the response, so callers must invoke this inside a
 * Server Action / Route Handler context (cookies().set() requires that).
 */
export async function issueOAuthState(provider: string): Promise<string> {
  const value = `${provider}.${crypto.randomBytes(24).toString('hex')}`;
  const jar = await cookies();
  jar.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return value;
}

/**
 * Validate the state returned by the OAuth callback against the cookie we
 * issued in issueOAuthState. Returns true on a clean match. The cookie is
 * cleared either way so a replay can't reuse it.
 */
export async function consumeOAuthState(provider: string, returned: string | null): Promise<boolean> {
  const jar = await cookies();
  const stored = jar.get(COOKIE_NAME)?.value ?? null;
  jar.delete(COOKIE_NAME);

  if (!stored || !returned) return false;
  if (!stored.startsWith(`${provider}.`)) return false;

  const storedBuf = Buffer.from(stored);
  const returnedBuf = Buffer.from(returned);
  if (storedBuf.length !== returnedBuf.length) return false;
  return crypto.timingSafeEqual(storedBuf, returnedBuf);
}
