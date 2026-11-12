import {
  listCalendarEventsWithToken,
  queryFreeBusyWithToken,
} from '@/features/integrations/services/calendar.service';
import {
  interpretFreeBusyEntry,
  lookupFreeBusyEntry,
  type CalendarRead,
} from '@/features/meetings/closer-availability.logic';
import { decrypt } from '@/lib/security/encryption';

import type { CloserCalendarConnectionRow } from './db';
import { markCloserConnectionDropped, saveCloserAccessToken } from './db';
import { parseCalendarEvents, titlesStatusFromError, type CalendarTitlesStatus } from './events';
import { refreshCloserAccessToken } from './google';
import { sealOAuthToken } from './token';

const FRESH_MS = 5 * 60 * 1000;

export type { CalendarTitlesStatus };

export interface CalendarReadWithTitles {
  calendar: CalendarRead;
  titles: CalendarTitlesStatus;
}

/**
 * Agenda própria do closer com títulos. Tenta events.list e, se falhar por
 * escopo, acesso ou rede, cai no freeBusy com o mesmo token. Se o freeBusy
 * também falhar, a agenda fica desconhecida como antes.
 */
export async function readCloserOwnAgenda(
  connection: CloserCalendarConnectionRow,
  timeMin: string,
  timeMax: string,
): Promise<CalendarReadWithTitles> {
  if (connection.status !== 'connected') return { calendar: { known: false, reason: 'token_revogado' }, titles: 'not_tried' };
  const access = await accessTokenFor(connection);
  if (!access.ok) {
    if (access.revoked) await markCloserConnectionDropped(connection);
    return { calendar: { known: false, reason: access.revoked ? 'token_revogado' : 'freebusy_failed' }, titles: 'not_tried' };
  }
  let titles: CalendarTitlesStatus;
  try {
    const items = await listCalendarEventsWithToken(access.token, connection.calendarEmail, timeMin, timeMax);
    return { calendar: { known: true, busy: parseCalendarEvents(items, { closerEmail: connection.calendarEmail }) }, titles: 'ok' };
  } catch (err) {
    titles = titlesStatusFromError(err);
    if (titles === 'failed') console.error('[closer-calendar] events.list da agenda do closer falhou, usando freeBusy', err instanceof Error ? err.message : err);
  }
  try {
    const calendars = await queryFreeBusyWithToken(access.token, timeMin, timeMax, [connection.calendarEmail]);
    return { calendar: interpretFreeBusyEntry(lookupFreeBusyEntry(calendars, connection.calendarEmail)), titles };
  } catch (err) {
    console.error('[closer-calendar] freeBusy da agenda do closer falhou', err);
    return { calendar: { known: false, reason: 'freebusy_failed' }, titles };
  }
}

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
