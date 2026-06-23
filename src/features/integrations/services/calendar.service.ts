import { decrypt, encrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { GOOGLE_TOKEN_URL } from '../constants/oauth-endpoints';

const GCAL_API = 'https://www.googleapis.com/calendar/v3';

function getGcalClientId() {
  return process.env.GCAL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '';
}
function getGcalClientSecret() {
  return process.env.GCAL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? '';
}

interface CalendarConnectionTokens {
  id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string;
  calendar_email: string;
}

interface GCalEvent {
  id: string;
  htmlLink: string;
  hangoutLink?: string;
  status: string;
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
}

interface FreeBusyCalendar {
  busy: Array<{ start: string; end: string }>;
}

interface FreeBusyResponse {
  calendars: Record<string, FreeBusyCalendar>;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  attendeeEmails?: string[];
  generateMeetLink?: boolean;
  closerId?: string;
}

export interface CalendarEvent {
  id: string;
  htmlLink: string;
  meetLink: string | null;
  summary: string;
  startTime: string;
  endTime: string;
}

export interface BusySlot {
  start: string;
  end: string;
}

/**
 * Thrown when a Google Calendar event we still track no longer exists (the API
 * answers 404 Not Found or 410 Gone — e.g. it was deleted directly in Google).
 * Callers can catch this to recreate the event instead of failing the whole
 * operation, so a reschedule still lands on the calendar.
 */
export class CalendarEventGoneError extends Error {
  constructor(eventId: string) {
    super(`Evento de calendário não existe mais: ${eventId}`);
    this.name = 'CalendarEventGone';
  }
}

async function ensureValidToken(connection: CalendarConnectionTokens): Promise<string> {
  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();

  // If token still valid (with 5-min buffer), return decrypted token
  if (expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
    return decrypt(connection.access_token_encrypted);
  }

  // Check if refresh token exists
  if (!connection.refresh_token_encrypted) {
    console.error(`[gcal] No refresh token for connection ${connection.id} — user must reconnect`);
    const serviceClient = createServiceRoleClient();
    await from(serviceClient, 'calendar_connections')
      .update({ status: 'error' } as Record<string, unknown>)
      .eq('id', connection.id);
    const err = new Error('Google Calendar desconectado. Reconecte em Configurações > Integrações.');
    err.name = 'GCalTokenExpired';
    throw err;
  }

  // Refresh the token
  const clientId = getGcalClientId();
  const clientSecret = getGcalClientSecret();

  let refreshToken: string;
  try {
    refreshToken = decrypt(connection.refresh_token_encrypted);
  } catch (decryptErr) {
    console.error(`[gcal] Failed to decrypt refresh token for connection ${connection.id}:`, decryptErr);
    const serviceClient = createServiceRoleClient();
    await from(serviceClient, 'calendar_connections')
      .update({ status: 'error' } as Record<string, unknown>)
      .eq('id', connection.id);
    const err = new Error('A conexão com o Google expirou. Reconecte em Configurações > Integrações.');
    err.name = 'GCalTokenExpired';
    throw err;
  }

  if (!refreshToken) {
    console.error(`[gcal] Empty refresh token after decrypt for connection ${connection.id}`);
    const serviceClient = createServiceRoleClient();
    await from(serviceClient, 'calendar_connections')
      .update({ status: 'error' } as Record<string, unknown>)
      .eq('id', connection.id);
    const err = new Error('Google Calendar desconectado. Reconecte em Configurações > Integrações.');
    err.name = 'GCalTokenExpired';
    throw err;
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    console.error(
      `[gcal] Token refresh failed (HTTP ${response.status}) for connection ${connection.id}:`,
      errorBody,
    );

    const serviceClient = createServiceRoleClient();

    // Recovery: try the Gmail connection's refresh token (unified OAuth — same Google account).
    // This handles drift between gmail_connections and calendar_connections refresh tokens.
    const { data: calConn } = (await from(serviceClient, 'calendar_connections')
      .select('user_id, org_id')
      .eq('id', connection.id)
      .maybeSingle()) as { data: { user_id: string; org_id: string } | null };

    if (calConn) {
      const { data: gmailConn } = (await from(serviceClient, 'gmail_connections')
        .select('refresh_token_encrypted')
        .eq('user_id', calConn.user_id)
        .eq('org_id', calConn.org_id)
        .maybeSingle()) as { data: { refresh_token_encrypted: string } | null };

      const gmailToken = gmailConn?.refresh_token_encrypted;
      if (gmailToken && gmailToken !== connection.refresh_token_encrypted) {
        try {
          const recoveredRefreshToken = decrypt(gmailToken);
          const retryResponse = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            signal: AbortSignal.timeout(10_000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: recoveredRefreshToken,
              grant_type: 'refresh_token',
            }),
          });
          if (retryResponse.ok) {
            const recoveredTokens = (await retryResponse.json()) as { access_token: string; expires_in: number };
            const newExpiresAt = new Date(Date.now() + recoveredTokens.expires_in * 1000).toISOString();
            await from(serviceClient, 'calendar_connections')
              .update({
                access_token_encrypted: encrypt(recoveredTokens.access_token),
                refresh_token_encrypted: gmailToken,
                token_expires_at: newExpiresAt,
                status: 'connected',
              } as Record<string, unknown>)
              .eq('id', connection.id);
            console.warn('[gcal] Recovered token via gmail_connections sync');
            return recoveredTokens.access_token;
          }
        } catch (e) {
          console.warn('[gcal] Recovery via gmail_connections failed:', e);
        }
      }
    }

    await from(serviceClient, 'calendar_connections')
      .update({ status: 'error' } as Record<string, unknown>)
      .eq('id', connection.id);

    const err = new Error(
      'Sessão do Google Calendar expirada. Reconecte em Configurações > Integrações.',
    );
    err.name = 'GCalTokenExpired';
    throw err;
  }

  const tokens = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Update stored token (encrypted)
  const supabase = await createServerSupabaseClient();
  await from(supabase, 'calendar_connections')
    .update({
      access_token_encrypted: encrypt(tokens.access_token),
      token_expires_at: newExpiresAt,
      status: 'connected',
    } as Record<string, unknown>)
    .eq('id', connection.id);

  return tokens.access_token;
}

export async function getCalendarConnection(
  userId: string,
  orgId: string,
): Promise<CalendarConnectionTokens | null> {
  const supabase = await createServerSupabaseClient();

  // Include 'error' status — ensureValidToken will attempt auto-refresh
  const { data } = (await from(supabase, 'calendar_connections')
    .select('id, access_token_encrypted, refresh_token_encrypted, token_expires_at, calendar_email')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .in('status', ['connected', 'error'])
    .maybeSingle()) as { data: CalendarConnectionTokens | null };

  return data;
}

export async function createCalendarEvent(
  connection: CalendarConnectionTokens,
  input: CreateEventInput,
): Promise<CalendarEvent> {
  const accessToken = await ensureValidToken(connection);

  const event: Record<string, unknown> = {
    summary: input.title,
    description: input.description ?? '',
    start: { dateTime: input.startTime, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: input.endTime, timeZone: 'America/Sao_Paulo' },
  };

  if (input.attendeeEmails && input.attendeeEmails.length > 0) {
    event.attendees = input.attendeeEmails.map((email) => ({ email }));
  }

  if (input.generateMeetLink) {
    event.conferenceData = {
      createRequest: {
        requestId: `enriqueceai-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const params = input.generateMeetLink ? '?conferenceDataVersion=1&sendUpdates=all' : '?sendUpdates=all';

  const response = await fetch(
    `${GCAL_API}/calendars/primary/events${params}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(event),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro ao criar evento: ${errorText}`);
  }

  const created = (await response.json()) as GCalEvent;

  return {
    id: created.id,
    htmlLink: created.htmlLink,
    meetLink: created.hangoutLink ?? null,
    summary: created.summary,
    startTime: created.start.dateTime,
    endTime: created.end.dateTime,
  };
}

export async function deleteCalendarEvent(
  connection: CalendarConnectionTokens,
  eventId: string,
): Promise<void> {
  const accessToken = await ensureValidToken(connection);

  const response = await fetch(
    `${GCAL_API}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  // 204 = success, 410 = already deleted (treat as success)
  if (!response.ok && response.status !== 410) {
    const errorText = await response.text();
    throw new Error(`Erro ao excluir evento: ${errorText}`);
  }
}

export async function updateCalendarEvent(
  connection: CalendarConnectionTokens,
  eventId: string,
  input: CreateEventInput,
): Promise<CalendarEvent> {
  const accessToken = await ensureValidToken(connection);

  const event: Record<string, unknown> = {
    summary: input.title,
    description: input.description ?? '',
    start: { dateTime: input.startTime, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: input.endTime, timeZone: 'America/Sao_Paulo' },
  };

  if (input.attendeeEmails && input.attendeeEmails.length > 0) {
    event.attendees = input.attendeeEmails.map((email) => ({ email }));
  }

  // For updates, don't send conferenceData.createRequest — it causes 400 if a Meet link already exists.
  // The existing conference is preserved automatically by Google Calendar on PATCH.
  const params = '?sendUpdates=all';

  const response = await fetch(
    `${GCAL_API}/calendars/primary/events/${encodeURIComponent(eventId)}${params}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(event),
    },
  );

  if (!response.ok) {
    // 404/410 → the tracked event is gone. Surface a typed error so the caller
    // can recreate it instead of leaving the reschedule stranded.
    if (response.status === 404 || response.status === 410) {
      throw new CalendarEventGoneError(eventId);
    }
    const errorText = await response.text();
    throw new Error(`Erro ao atualizar evento: ${errorText}`);
  }

  const updated = (await response.json()) as GCalEvent;

  // An event deleted directly in Google Calendar is NOT a 404 here: a PATCH
  // against it still returns HTTP 200, but the resource comes back with
  // status "cancelled" — the new time is applied to a tombstone that never
  // renders on anyone's calendar. (This is exactly how Ismael's rescheduled
  // meeting vanished: he deleted the event in Google, then hit "Reagendar".)
  // Treat it as gone so the caller recreates a fresh, confirmed event instead
  // of silently reporting success.
  if (updated.status === 'cancelled') {
    throw new CalendarEventGoneError(eventId);
  }

  return {
    id: updated.id,
    htmlLink: updated.htmlLink,
    meetLink: updated.hangoutLink ?? null,
    summary: updated.summary,
    startTime: updated.start.dateTime,
    endTime: updated.end.dateTime,
  };
}

export async function checkFreeBusy(
  connection: CalendarConnectionTokens,
  timeMin: string,
  timeMax: string,
): Promise<BusySlot[]> {
  const accessToken = await ensureValidToken(connection);

  const response = await fetch(`${GCAL_API}/freeBusy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone: 'America/Sao_Paulo',
      items: [{ id: connection.calendar_email }],
    }),
  });

  if (!response.ok) {
    throw new Error('Erro ao verificar disponibilidade');
  }

  const data = (await response.json()) as FreeBusyResponse;
  const calendarBusy = data.calendars[connection.calendar_email];

  return calendarBusy?.busy ?? [];
}
