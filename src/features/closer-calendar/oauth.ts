import { isUuid } from '@/lib/utils/uuid';

import { CLOSER_CALENDAR_CALLBACK_PATH, CLOSER_CALENDAR_SCOPES } from './constants';
import { hashSecret, secretsMatch } from './token';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

export interface OAuthInviteRecord {
  id: string;
  orgId: string;
  closerId: string;
  closerName: string;
  closerEmail: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  oauthStateHash: string | null;
  oauthStateExpiresAt: string | null;
}

export type OAuthFinishStatus =
  | 'ok'
  | 'denied'
  | 'invalid'
  | 'expired'
  | 'used'
  | 'revoked'
  | 'mismatch'
  | 'error'
  | 'unavailable';

export function closerCalendarRedirectUri(appUrl: string): string {
  return `${appUrl.replace(/\/$/, '')}${CLOSER_CALENDAR_CALLBACK_PATH}`;
}

export function buildCloserCalendarAuthUrl(input: {
  clientId: string;
  appUrl: string;
  inviteId: string;
  nonce: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: closerCalendarRedirectUri(input.appUrl),
    response_type: 'code',
    scope: CLOSER_CALENDAR_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: `${input.inviteId}.${input.nonce}`,
  });
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

export function parseOAuthState(state: string | null): { inviteId: string; nonce: string } | null {
  if (!state) return null;
  const dot = state.indexOf('.');
  if (dot <= 0) return null;
  const inviteId = state.slice(0, dot);
  const nonce = state.slice(dot + 1);
  if (!isUuid(inviteId) || nonce.length < 32) return null;
  return { inviteId, nonce };
}

export function refreshFailureIsRevoked(status: number, body: string): boolean {
  return (status === 400 || status === 401) && body.includes('invalid_grant');
}

export function googleEmailsMatch(closerEmail: string, googleEmail: string): boolean {
  return closerEmail.trim().toLowerCase() === googleEmail.trim().toLowerCase();
}

function inviteBlock(invite: OAuthInviteRecord, now: Date): OAuthFinishStatus | null {
  if (invite.revokedAt) return 'revoked';
  if (invite.usedAt) return 'used';
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return 'expired';
  return null;
}

export async function completeCloserCalendarOAuth(input: {
  code: string | null;
  state: string | null;
  googleError: string | null;
  now: Date;
  loadInvite: (inviteId: string) => Promise<OAuthInviteRecord | null>;
  clearState: (inviteId: string) => Promise<void>;
  exchangeCode: (code: string) => Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number } | null>;
  fetchGoogleEmail: (accessToken: string) => Promise<string | null>;
  saveConnection: (args: {
    orgId: string;
    closerId: string;
    calendarEmail: string;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }) => Promise<boolean>;
  markUsed: (inviteId: string) => Promise<boolean>;
}): Promise<OAuthFinishStatus> {
  if (input.googleError) {
    const parsed = parseOAuthState(input.state);
    if (parsed) await input.clearState(parsed.inviteId);
    return input.googleError === 'access_denied' ? 'denied' : 'error';
  }

  const parsed = parseOAuthState(input.state);
  if (!parsed || !input.code) return 'invalid';

  const invite = await input.loadInvite(parsed.inviteId);
  if (!invite) return 'invalid';

  const blocked = inviteBlock(invite, input.now);
  if (blocked) return blocked;

  const stateFresh = invite.oauthStateHash
    && invite.oauthStateExpiresAt
    && new Date(invite.oauthStateExpiresAt).getTime() > input.now.getTime()
    && secretsMatch(invite.oauthStateHash, hashSecret(parsed.nonce));
  if (!stateFresh) return 'invalid';

  const tokens = await input.exchangeCode(input.code);
  if (!tokens?.accessToken || !tokens.refreshToken) {
    await input.clearState(invite.id);
    return 'error';
  }

  const googleEmail = await input.fetchGoogleEmail(tokens.accessToken);
  if (!googleEmail || !googleEmailsMatch(invite.closerEmail, googleEmail)) {
    await input.clearState(invite.id);
    return 'mismatch';
  }

  const saved = await input.saveConnection({
    orgId: invite.orgId,
    closerId: invite.closerId,
    calendarEmail: googleEmail.trim().toLowerCase(),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
  });
  if (!saved) return 'error';

  const used = await input.markUsed(invite.id);
  if (!used) return 'used';
  return 'ok';
}
