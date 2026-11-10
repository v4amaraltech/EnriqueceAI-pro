import { GOOGLE_TOKEN_URL } from '@/features/integrations/constants/oauth-endpoints';
import { getAppUrl } from '@/lib/utils/app-url';

import { closerCalendarRedirectUri, refreshFailureIsRevoked } from './oauth';

function clientId(): string {
  return process.env.GCAL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '';
}

function clientSecret(): string {
  return process.env.GCAL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? '';
}

export function closerCalendarClientId(): string {
  return clientId();
}

export async function exchangeCloserCalendarCode(
  code: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number } | null> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) return null;
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: closerCalendarRedirectUri(getAppUrl()),
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) return null;
  const tokens = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token) return null;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresIn: tokens.expires_in ?? 3600,
  };
}

export async function fetchGoogleAccountEmail(accessToken: string): Promise<string | null> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { email?: string };
  const email = body.email?.trim().toLowerCase() ?? '';
  return email || null;
}

export async function refreshCloserAccessToken(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; accessToken: string; expiresIn: number } | { ok: false; revoked: boolean }> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret || !refreshToken) return { ok: false, revoked: false };
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return { ok: false, revoked: refreshFailureIsRevoked(response.status, body) };
  }
  const tokens = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!tokens.access_token) return { ok: false, revoked: false };
  return { ok: true, accessToken: tokens.access_token, expiresIn: tokens.expires_in ?? 3600 };
}
