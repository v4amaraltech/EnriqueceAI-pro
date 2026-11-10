import { getAppUrl } from '@/lib/utils/app-url';

import { CLOSER_CALENDAR_STATE_MINUTES } from './constants';
import {
  appendCloserCalendarEvent,
  clearInviteOAuthState,
  loadInviteById,
  loadInviteByTokenHash,
  markInviteUsed,
  saveCloserCalendarConnection,
  setInviteOAuthState,
} from './db';
import { isCloserCalendarConnectEnabled } from './flag';
import { closerCalendarClientId, exchangeCloserCalendarCode, fetchGoogleAccountEmail } from './google';
import { buildCloserCalendarAuthUrl, completeCloserCalendarOAuth, parseOAuthState, type OAuthFinishStatus } from './oauth';
import { createOAuthNonce, hashSecret, sealOAuthToken } from './token';

export type PublicInviteView =
  | { status: 'ready'; name: string }
  | { status: Exclude<OAuthFinishStatus, 'ok' | 'mismatch' | 'denied'> };

export async function describeCloserCalendarInvite(rawToken: string): Promise<PublicInviteView> {
  if (!acceptableToken(rawToken)) return { status: 'invalid' };
  const invite = await loadInviteByTokenHash(hashSecret(rawToken));
  if (!invite) return { status: 'invalid' };
  if (!(await isCloserCalendarConnectEnabled(invite.orgId))) return { status: 'unavailable' };
  if (invite.revokedAt) return { status: 'revoked' };
  if (invite.usedAt) return { status: 'used' };
  if (new Date(invite.expiresAt).getTime() <= Date.now()) return { status: 'expired' };
  return { status: 'ready', name: invite.closerName };
}

export async function beginCloserCalendarOAuth(rawToken: string): Promise<{ ok: true; url: string } | { ok: false; status: OAuthFinishStatus }> {
  const view = await describeCloserCalendarInvite(rawToken);
  if (view.status !== 'ready') return { ok: false, status: view.status };
  const invite = await loadInviteByTokenHash(hashSecret(rawToken));
  if (!invite) return { ok: false, status: 'invalid' };
  const clientId = closerCalendarClientId();
  if (!clientId) return { ok: false, status: 'error' };
  const nonce = createOAuthNonce();
  const stateExpiresAt = new Date(Date.now() + CLOSER_CALENDAR_STATE_MINUTES * 60 * 1000).toISOString();
  const stored = await setInviteOAuthState({
    inviteId: invite.id,
    stateHash: nonce.hash,
    stateExpiresAt,
  });
  if (!stored) return { ok: false, status: 'invalid' };
  return {
    ok: true,
    url: buildCloserCalendarAuthUrl({
      clientId,
      appUrl: getAppUrl(),
      inviteId: invite.id,
      nonce: nonce.nonce,
    }),
  };
}

export async function finishCloserCalendarOAuth(input: {
  code: string | null;
  state: string | null;
  googleError: string | null;
}): Promise<OAuthFinishStatus> {
  if (!input.googleError) {
    const parsed = parseOAuthState(input.state);
    if (parsed) {
      const invite = await loadInviteById(parsed.inviteId);
      if (invite && !(await isCloserCalendarConnectEnabled(invite.orgId))) return 'unavailable';
    }
  }

  const connected: { current: { orgId: string; closerId: string } | null } = { current: null };
  const status = await completeCloserCalendarOAuth({
    code: input.code,
    state: input.state,
    googleError: input.googleError,
    now: new Date(),
    loadInvite: loadInviteById,
    clearState: clearInviteOAuthState,
    exchangeCode: exchangeCloserCalendarCode,
    fetchGoogleEmail: fetchGoogleAccountEmail,
    saveConnection: async (args) => {
      const access = sealOAuthToken(args.accessToken);
      const refresh = sealOAuthToken(args.refreshToken);
      if (!access.ok || !refresh.ok) return false;
      const saved = await saveCloserCalendarConnection({
        orgId: args.orgId,
        closerId: args.closerId,
        calendarEmail: args.calendarEmail,
        accessTokenEncrypted: access.ciphertext,
        refreshTokenEncrypted: refresh.ciphertext,
        tokenExpiresAt: new Date(Date.now() + args.expiresIn * 1000).toISOString(),
      });
      if (saved) connected.current = { orgId: args.orgId, closerId: args.closerId };
      return saved;
    },
    markUsed: markInviteUsed,
  });

  if (status === 'ok' && connected.current) {
    await appendCloserCalendarEvent({
      orgId: connected.current.orgId,
      closerId: connected.current.closerId,
      kind: 'connected',
    });
  }
  return status;
}

function acceptableToken(rawToken: string): boolean {
  return /^[A-Za-z0-9_-]{40,200}$/.test(rawToken);
}
