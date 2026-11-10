import { queryFreeBusyWithToken } from '@/features/integrations/services/calendar.service';
import {
  interpretFreeBusyEntry,
  lookupFreeBusyEntry,
  type CalendarRead,
} from '@/features/meetings/closer-availability.logic';
import { decrypt } from '@/lib/security/encryption';

import type { CloserCalendarConnectionRow } from './db';
import { markCloserConnectionDropped, saveCloserAccessToken } from './db';
import { refreshCloserAccessToken } from './google';
import { sealOAuthToken } from './token';

const FRESH_MS = 5 * 60 * 1000;

export async function readCloserOwnFreeBusy(
  connection: CloserCalendarConnectionRow,
  timeMin: string,
  timeMax: string,
): Promise<CalendarRead> {
  if (connection.status !== 'connected') return { known: false, reason: 'token_revogado' };
  const access = await accessTokenFor(connection);
  if (!access.ok) {
    if (access.revoked) await markCloserConnectionDropped(connection);
    return { known: false, reason: access.revoked ? 'token_revogado' : 'freebusy_failed' };
  }
  try {
    const calendars = await queryFreeBusyWithToken(access.token, timeMin, timeMax, [connection.calendarEmail]);
    return interpretFreeBusyEntry(lookupFreeBusyEntry(calendars, connection.calendarEmail));
  } catch (err) {
    console.error('[closer-calendar] freeBusy da agenda do closer falhou', err);
    return { known: false, reason: 'freebusy_failed' };
  }
}

async function accessTokenFor(
  connection: CloserCalendarConnectionRow,
): Promise<{ ok: true; token: string } | { ok: false; revoked: boolean }> {
  const expiresAt = new Date(connection.tokenExpiresAt).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > FRESH_MS) {
    try {
      const token = decrypt(connection.accessTokenEncrypted);
      if (token) return { ok: true, token };
    } catch (err) {
      console.error('[closer-calendar] access token ilegível', err);
    }
    return { ok: false, revoked: false };
  }

  let refreshToken = '';
  try {
    refreshToken = decrypt(connection.refreshTokenEncrypted);
  } catch (err) {
    console.error('[closer-calendar] refresh token ilegível', err);
    return { ok: false, revoked: false };
  }
  const refreshed = await refreshCloserAccessToken(refreshToken);
  if (!refreshed.ok) return refreshed;
  const sealed = sealOAuthToken(refreshed.accessToken);
  if (!sealed.ok) return { ok: false, revoked: false };
  const tokenExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
  await saveCloserAccessToken(connection.id, sealed.ciphertext, tokenExpiresAt);
  return { ok: true, token: refreshed.accessToken };
}
