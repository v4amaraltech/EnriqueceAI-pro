import { decrypt, encrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const GCAL_API = 'https://www.googleapis.com/calendar/v3';

function getGcalClientId() {
  return process.env.GCAL_CLIENT_ID ?? '';
}
function getGcalClientSecret() {
  return process.env.GCAL_CLIENT_SECRET ?? '';
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
  attendeeEmail?: string;
  generateMeetLink?: boolean;
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

async function ensureValidToken(connection: CalendarConnectionTokens): Promise<string> {
  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();

  // If token still valid (with 5-min buffer), return decrypted token
  if (expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
    return decrypt(connection.access_token_encrypted);
  }

  // Refresh the token
  const clientId = getGcalClientId();
  const clientSecret = getGcalClientSecret();

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decrypt(connection.refresh_token_encrypted),
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    // Mark connection as error
    const supabase = await createServerSupabaseClient();
    await from(supabase, 'calendar_connections')
      .update({ status: 'error' } as Record<string, unknown>)
      .eq('id', connection.id);
    throw new Error('Erro ao renovar token do Google Calendar');
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

  if (input.attendeeEmail) {
    event.attendees = [{ email: input.attendeeEmail }];
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
