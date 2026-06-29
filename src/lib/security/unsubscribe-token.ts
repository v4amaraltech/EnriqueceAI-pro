import crypto from 'crypto';

// M9: stateless signed token for unsubscribe links. Carries the lead id + email
// and is HMAC-signed so the public /api/unsubscribe endpoint can trust it without
// storing a per-link token. Server-only — the secret never reaches the browser.

function getSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SIGNING_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error('Missing signing secret for unsubscribe tokens (SUPABASE_SERVICE_ROLE_KEY).');
  }
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

/** Build a stateless, signed unsubscribe token carrying the lead id + email. */
export function signUnsubscribeToken(leadId: string, email: string): string {
  const payload = `${leadId}:${email.toLowerCase()}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

/** Verify an unsubscribe token. Returns the lead id + email, or null if invalid. */
export function verifyUnsubscribeToken(token: string): { leadId: string; email: string } | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const payloadB64 = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expectedSig = sign(payload);
  const provided = Buffer.from(providedSig);
  const expected = Buffer.from(expectedSig);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  // payload = "<uuid leadId>:<email>" — leadId is a UUID (no ':'), so split once.
  const sep = payload.indexOf(':');
  if (sep <= 0) return null;
  const leadId = payload.slice(0, sep);
  const email = payload.slice(sep + 1);
  if (!leadId || !email) return null;
  return { leadId, email };
}
