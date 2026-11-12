import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import type { Database } from '@/lib/supabase/types';
import { BR_NATIONAL_HOLIDAYS } from '@/lib/utils/br-holidays';

import { loadCloserOwnConnection } from '@/features/closer-calendar/db';
import { isCloserCalendarConnectEnabled } from '@/features/closer-calendar/flag';
import { calendarReadPlan } from '@/features/closer-calendar/plan';
import { parseCalendarEvents, titlesStatusFromError, type CalendarTitlesStatus } from '@/features/closer-calendar/events';
import { readCloserOwnAgenda, type CalendarReadWithTitles } from '@/features/closer-calendar/read';
import {
  getCalendarConnection,
  getCalendarConnectionWith,
  listCalendarEvents,
  queryFreeBusy,
  type CalendarConnectionTokens,
} from '@/features/integrations/services/calendar.service';
import { MEETING_DURATION_MIN } from './meeting-duration';
import {
  availabilityNotice,
  bookingDecision,
  brtDateKeyFromInstant,
  classifySlot,
  fallbackBlocks,
  interpretFreeBusyEntry,
  interpretHoldError,
  lookupFreeBusyEntry,
  meetingInstant,
  meetingWindow,
  type AvailabilitySource,
  type BusyInterval,
  type CalendarRead,
} from './closer-availability.logic';

type Db = SupabaseClient<Database>;

export interface CloserAvailabilityData {
  closerId: string;
  source: AvailabilitySource;
  calendarKnown: boolean;
  reason: string | null;
  notice: string | null;
  calendarBusy: BusyInterval[];
  appBusy: BusyInterval[];
  holidays: string[];
  sdrBusy: BusyInterval[];
  /**
   * A conexão própria do closer é antiga (só freeBusy) e o Google recusou o
   * events.list por escopo. A grade mostra "Ocupado" sem título e pede para
   * o closer reconectar pelo convite do gestor.
   */
  needsReconnectForTitles?: boolean;
}

export type ReserveResult =
  | { ok: true; holdId: string | null }
  | { ok: false; error: string; code: string };

function rangeInstants(timeMin: string, timeMax: string): { start: Date; end: Date } | null {
  const start = meetingInstant(timeMin);
  const end = meetingInstant(timeMax);
  if (!start || !end || end.getTime() <= start.getTime()) return null;
  return { start, end };
}

async function resolveCloserUserId(orgId: string, email: string): Promise<string | null> {
  const normalized = email.trim();
  if (!normalized) return null;
  try {
    const admin = createServiceRoleClient();
    const { data, error } = await admin.rpc('find_user_id_by_email', { p_email: normalized });
    if (error || !data) return null;
    const { data: member } = (await from(admin, 'organization_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('user_id', data)
      .eq('status', 'active')
      .maybeSingle()) as { data: { user_id: string } | null };
    return member?.user_id ?? null;
  } catch (err) {
    console.error('[closer-availability] usuário do closer não resolvido', err);
    return null;
  }
}

async function readCalendars(
  connection: CalendarConnectionTokens,
  timeMin: string,
  timeMax: string,
  calendarIds: string[],
): Promise<Record<string, CalendarRead>> {
  try {
    const calendars = await queryFreeBusy(connection, timeMin, timeMax, calendarIds);
    const out: Record<string, CalendarRead> = {};
    for (const id of calendarIds) {
      out[id] = interpretFreeBusyEntry(lookupFreeBusyEntry(calendars, id));
    }
    return out;
  } catch (err) {
    console.error('[closer-availability] freeBusy falhou', err);
    const failed: Record<string, CalendarRead> = {};
    for (const id of calendarIds) failed[id] = { known: false, reason: 'freebusy_failed' };
    return failed;
  }
}

/**
 * events.list com a conexão de plataforma ou do SDR. Se falhar (escopo,
 * acesso, rede), cai no freeBusy de sempre, sem título.
 */
async function readCalendarWithTitles(
  connection: CalendarConnectionTokens,
  timeMin: string,
  timeMax: string,
  calendarId: string,
  closerEmail: string,
): Promise<CalendarReadWithTitles> {
  let titles: CalendarTitlesStatus;
  try {
    const items = await listCalendarEvents(connection, calendarId, timeMin, timeMax);
    return { calendar: { known: true, busy: parseCalendarEvents(items, { closerEmail }) }, titles: 'ok' };
  } catch (err) {
    titles = titlesStatusFromError(err);
    if (titles === 'failed') {
      console.error('[closer-availability] events.list falhou, usando freeBusy', err instanceof Error ? err.message : err);
    }
  }
  const reads = await readCalendars(connection, timeMin, timeMax, [calendarId]);
  return { calendar: reads[calendarId] ?? { known: false, reason: 'sem_resposta' }, titles };
}

/** Cache curto, em memória, da agenda do closer já interpretada. Nunca guarda token. */
export const CLOSER_EVENTS_CACHE_TTL_MS = 45_000;
const CLOSER_EVENTS_CACHE_MAX = 500;

interface CachedCloserRead {
  expiresAt: number;
  calendar: CalendarRead;
  source: AvailabilitySource;
  ownTitles: CalendarTitlesStatus;
}

const closerEventsCache = new Map<string, CachedCloserRead>();

export function clearCloserEventsCache(): void {
  closerEventsCache.clear();
}

function readCache(key: string): CachedCloserRead | null {
  const hit = closerEventsCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    closerEventsCache.delete(key);
    return null;
  }
  return hit;
}

function writeCache(key: string, value: Omit<CachedCloserRead, 'expiresAt'>): void {
  if (closerEventsCache.size >= CLOSER_EVENTS_CACHE_MAX) {
    const now = Date.now();
    for (const [entryKey, entry] of closerEventsCache) {
      if (entry.expiresAt <= now) closerEventsCache.delete(entryKey);
    }
    if (closerEventsCache.size >= CLOSER_EVENTS_CACHE_MAX) {
      const oldest = closerEventsCache.keys().next().value;
      if (oldest !== undefined) closerEventsCache.delete(oldest);
    }
  }
  closerEventsCache.set(key, { ...value, expiresAt: Date.now() + CLOSER_EVENTS_CACHE_TTL_MS });
}

async function loadHolidays(supabase: Db, fromDate: string, toDate: string): Promise<string[]> {
  const { data, error } = (await from(supabase, 'business_holidays')
    .select('holiday_date')
    .gte('holiday_date', fromDate)
    .lte('holiday_date', toDate)) as { data: Array<{ holiday_date: string }> | null; error: { message: string } | null };
  if (!error && data) return data.map((row) => row.holiday_date.slice(0, 10));
  console.error('[closer-availability] feriados indisponíveis, usando a lista do app', error?.message);
  return Object.keys(BR_NATIONAL_HOLIDAYS).filter((date) => date >= fromDate && date <= toDate);
}

async function loadAppBusy(
  supabase: Db,
  orgId: string,
  closerId: string,
  timeMin: string,
  timeMax: string,
): Promise<{ meetings: BusyInterval[]; unreadable: boolean }> {
  const start = meetingInstant(timeMin);
  const end = meetingInstant(timeMax);
  if (!start || !end) return { meetings: [], unreadable: true };
  const windowStart = new Date(start.getTime() - MEETING_DURATION_MIN * 60_000).toISOString();
  const { data, error } = (await from(supabase, 'leads')
    .select('id, meeting_starts_at')
    .eq('org_id', orgId)
    .eq('closer_id', closerId)
    .not('meeting_scheduled_at', 'is', null)
    .not('meeting_starts_at', 'is', null)
    .gte('meeting_starts_at', windowStart)
    .lt('meeting_starts_at', end.toISOString())) as {
    data: Array<{ id: string; meeting_starts_at: string }> | null;
    error: { message: string } | null;
  };
  if (error) {
    console.error('[closer-availability] reuniões do closer indisponíveis', error.message);
    return { meetings: [], unreadable: true };
  }
  const meetings: BusyInterval[] = [];
  for (const row of data ?? []) {
    const meetingStart = meetingInstant(row.meeting_starts_at);
    if (!meetingStart) continue;
    meetings.push({
      leadId: row.id,
      start: meetingStart.toISOString(),
      end: new Date(meetingStart.getTime() + MEETING_DURATION_MIN * 60_000).toISOString(),
    });
  }

  if (meetings.length > 0) {
    const leadIds = meetings.map((meeting) => meeting.leadId).filter((id): id is string => !!id);
    const { data: interactions, error: interactionError } = (await from(supabase, 'interactions')
      .select('lead_id, metadata')
      .eq('org_id', orgId)
      .eq('type', 'meeting_scheduled')
      .in('lead_id', leadIds)) as {
      data: Array<{ lead_id: string; metadata: { closer_id?: string; start_time?: string; end_time?: string } | null }> | null;
      error: { message?: string } | null;
    };
    if (interactionError) {
      console.error('[closer-availability] fim da reunião do app indisponível', interactionError.message);
    } else {
      for (const row of interactions ?? []) {
        const meta = row.metadata;
        if (!meta || meta.closer_id !== closerId || !meta.start_time) continue;
        const window = meetingWindow(meta.start_time, meta.end_time);
        const windowEnd = window ? meetingInstant(window.end) : null;
        const current = meetings.find((meeting) => meeting.leadId === row.lead_id);
        const currentEnd = current ? meetingInstant(current.end) : null;
        if (current && window && windowEnd && currentEnd && windowEnd.getTime() > currentEnd.getTime()) {
          current.end = window.end;
        }
      }
    }
  }

  const { data: holds, error: holdError } = (await from(supabase, 'closer_booking_holds')
    .select('lead_id, slot_start, slot_end')
    .eq('org_id', orgId)
    .eq('closer_id', closerId)
    .eq('status', 'held')
    .lt('slot_start', end.toISOString())
    .gt('slot_end', start.toISOString())) as {
    data: Array<{ lead_id: string | null; slot_start: string; slot_end: string }> | null;
    error: { code?: string; message?: string } | null;
  };
  if (holdError && interpretHoldError(holdError) === 'table_missing') return { meetings, unreadable: false };
  if (holdError) {
    console.error('[closer-availability] travas indisponíveis', holdError.message);
    return { meetings, unreadable: true };
  }
  for (const hold of holds ?? []) {
    meetings.push({
      leadId: hold.lead_id ?? undefined,
      start: hold.slot_start,
      end: hold.slot_end,
    });
  }
  return { meetings, unreadable: false };
}

export async function loadCloserAvailability(args: {
  supabase: Db;
  orgId: string;
  userId: string;
  closerId: string;
  timeMin: string;
  timeMax: string;
  sdrConnection?: CalendarConnectionTokens | null;
  /** Ignora o cache de 45s. A reserva no servidor sempre relê a agenda. */
  fresh?: boolean;
}): Promise<{ ok: true; data: CloserAvailabilityData } | { ok: false; error: string }> {
  const range = rangeInstants(args.timeMin, args.timeMax);
  if (!range) return { ok: false, error: 'Intervalo de agenda inválido.' };

  const { data: closer } = (await from(args.supabase, 'closers')
    .select('id, email, deleted_at')
    .eq('id', args.closerId)
    .eq('org_id', args.orgId)
    .maybeSingle()) as { data: { id: string; email: string | null; deleted_at: string | null } | null };
  if (!closer || closer.deleted_at) return { ok: false, error: 'Closer não encontrado.' };

  const closerEmail = closer.email?.trim() ?? '';
  const closerUserId = await resolveCloserUserId(args.orgId, closerEmail);
  let closerConnection: CalendarConnectionTokens | null = null;
  if (closerUserId) {
    try {
      closerConnection = await getCalendarConnectionWith(createServiceRoleClient(), closerUserId, args.orgId);
    } catch (err) {
      console.error('[closer-availability] conexão do closer indisponível', err);
    }
  }
  const sdrConnection = args.sdrConnection === undefined
    ? await getCalendarConnection(args.userId, args.orgId)
    : args.sdrConnection;

  let ownConnection: Awaited<ReturnType<typeof loadCloserOwnConnection>> = null;
  try {
    if (await isCloserCalendarConnectEnabled(args.orgId)) {
      ownConnection = await loadCloserOwnConnection(args.orgId, args.closerId);
    }
  } catch (err) {
    console.error('[closer-availability] conexão própria do closer indisponível', err);
  }
  const plan = calendarReadPlan({
    ownConnected: ownConnection?.status === 'connected',
    closerUserId,
    closerHasPlatformConnection: !!closerConnection,
    sdrHasConnection: !!sdrConnection,
  });

  const timeMinIso = range.start.toISOString();
  const timeMaxIso = range.end.toISOString();
  const readerId = plan === 'own'
    ? ownConnection?.id
    : plan === 'platform'
      ? closerConnection?.id
      : plan === 'sdr'
        ? sdrConnection?.id
        : 'none';
  const cacheKey = `${args.orgId}:${closer.id}:${plan}:${readerId ?? ''}:${sdrConnection?.id ?? ''}:${timeMinIso}:${timeMaxIso}`;
  const cached = args.fresh ? null : readCache(cacheKey);

  let source: AvailabilitySource = plan === 'own' || plan === 'platform' ? 'closer_token' : plan === 'sdr' ? 'sdr_token' : 'none';
  let calendar: CalendarRead = { known: false, reason: 'sem_conexao' };
  let ownTitles: CalendarTitlesStatus = 'not_tried';
  if (cached) {
    calendar = cached.calendar;
    source = cached.source;
    ownTitles = cached.ownTitles;
  } else {
    if (plan === 'own' && ownConnection) {
      const own = await readCloserOwnAgenda(ownConnection, timeMinIso, timeMaxIso);
      calendar = own.calendar;
      ownTitles = own.titles;
      if (!calendar.known && sdrConnection && closerEmail) {
        const second = await readCalendarWithTitles(sdrConnection, timeMinIso, timeMaxIso, closerEmail, closerEmail);
        if (second.calendar.known) {
          calendar = second.calendar;
          source = 'sdr_token';
        }
      }
    } else if (source === 'closer_token' && closerConnection) {
      const first = await readCalendarWithTitles(
        closerConnection,
        timeMinIso,
        timeMaxIso,
        closerConnection.calendar_email,
        closerEmail || closerConnection.calendar_email,
      );
      calendar = first.calendar;
      if (!calendar.known && sdrConnection && closerEmail) {
        const second = await readCalendarWithTitles(sdrConnection, timeMinIso, timeMaxIso, closerEmail, closerEmail);
        if (second.calendar.known) {
          calendar = second.calendar;
          source = 'sdr_token';
        }
      }
    } else if (source === 'sdr_token' && sdrConnection && closerEmail) {
      const read = await readCalendarWithTitles(sdrConnection, timeMinIso, timeMaxIso, closerEmail, closerEmail);
      calendar = read.calendar;
    }
    if (calendar.known) writeCache(cacheKey, { calendar, source, ownTitles });
  }
  const needsReconnectForTitles = plan === 'own' && ownTitles === 'insufficient_scope';

  const fromDate = brtDateKeyFromInstant(range.start);
  const toDate = brtDateKeyFromInstant(new Date(range.end.getTime() - 1));
  const [holidays, app] = await Promise.all([
    loadHolidays(args.supabase, fromDate, toDate),
    loadAppBusy(args.supabase, args.orgId, closer.id, timeMinIso, timeMaxIso),
  ]);

  const calendarKnown = calendar.known && !app.unreadable;
  const reason = calendar.known ? null : calendar.reason;
  let sdrBusy: BusyInterval[] = [];
  if (calendarKnown && sdrConnection) {
    const sameCalendar = source !== 'closer_token'
      && sdrConnection.calendar_email.toLowerCase() === closerEmail.toLowerCase();
    if (sameCalendar && calendar.known) {
      sdrBusy = calendar.busy;
    } else {
      const reads = await readCalendars(sdrConnection, timeMinIso, timeMaxIso, [sdrConnection.calendar_email]);
      const own = reads[sdrConnection.calendar_email];
      if (own?.known) sdrBusy = own.busy;
    }
  }

  return {
    ok: true,
    data: {
      closerId: closer.id,
      source,
      calendarKnown,
      reason: app.unreadable ? 'reunioes_app' : reason,
      notice: availabilityNotice({
        closerSelected: true,
        source,
        calendarKnown,
        reason: app.unreadable ? 'reunioes_app' : reason,
        appUnreadable: app.unreadable,
      }),
      calendarBusy: calendar.known ? calendar.busy : [],
      appBusy: app.meetings,
      holidays,
      sdrBusy,
      needsReconnectForTitles,
    },
  };
}

async function insertHold(args: {
  supabase: Db;
  orgId: string;
  closerId: string;
  leadId: string;
  userId: string;
  start: Date;
  end: Date;
}): Promise<{ id: string | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = (await from(args.supabase, 'closer_booking_holds')
    .insert({
      org_id: args.orgId,
      closer_id: args.closerId,
      lead_id: args.leadId,
      slot_start: args.start.toISOString(),
      slot_end: args.end.toISOString(),
      status: 'held',
      created_by: args.userId,
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: { code?: string; message?: string } | null };
  return { id: data?.id ?? null, error };
}

async function retargetLeadHold(args: {
  supabase: Db;
  orgId: string;
  leadId: string;
  closerId: string;
  start: Date;
  end: Date;
}): Promise<{ status: 'updated'; id: string } | { status: 'absent' } | { status: 'conflict' } | { status: 'missing' } | { status: 'error'; message?: string }> {
  const { data, error } = (await from(args.supabase, 'closer_booking_holds')
    .select('id')
    .eq('org_id', args.orgId)
    .eq('lead_id', args.leadId)
    .eq('status', 'held')
    .order('created_at', { ascending: false })
    .limit(1)) as { data: Array<{ id: string }> | null; error: { code?: string; message?: string } | null };
  if (error) {
    return interpretHoldError(error) === 'table_missing'
      ? { status: 'missing' }
      : { status: 'error', message: error.message };
  }
  const current = data?.[0];
  if (!current) return { status: 'absent' };
  const { error: updateError } = await from(args.supabase, 'closer_booking_holds')
    .update({
      closer_id: args.closerId,
      slot_start: args.start.toISOString(),
      slot_end: args.end.toISOString(),
    } as Record<string, unknown>)
    .eq('id', current.id)
    .eq('status', 'held');
  if (!updateError) return { status: 'updated', id: current.id };
  if (interpretHoldError(updateError) === 'conflict') return { status: 'conflict' };
  if (interpretHoldError(updateError) === 'table_missing') return { status: 'missing' };
  return { status: 'error', message: updateError.message };
}

export async function reserveCloserSlot(args: {
  supabase: Db;
  orgId: string;
  userId: string;
  closerId: string;
  leadId: string;
  startTime: string;
  endTime: string;
  excludeLeadId?: string;
  /** Remarcação: move a trava deste lead em vez de criar outra por cima dela. */
  retargetExisting?: boolean;
  sdrConnection?: CalendarConnectionTokens | null;
  /**
   * O SDR confirmou marcar por cima de um compromisso do Google. Não libera
   * reunião do Enriquece, trava, feriado nem agenda desconhecida.
   */
  allowOverlap?: boolean;
}): Promise<ReserveResult> {
  const start = meetingInstant(args.startTime);
  const end = meetingInstant(args.endTime);
  if (!start || !end || end.getTime() <= start.getTime()) {
    return { ok: false, error: 'Horário inválido.', code: 'INVALID_TIME' };
  }

  const loaded = await loadCloserAvailability({
    supabase: args.supabase,
    orgId: args.orgId,
    userId: args.userId,
    closerId: args.closerId,
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    sdrConnection: args.sdrConnection,
    fresh: true,
  });
  if (!loaded.ok) return { ok: false, error: loaded.error, code: 'CLOSER_UNKNOWN' };

  const appMeetings = args.excludeLeadId
    ? loaded.data.appBusy.filter((meeting) => meeting.leadId !== args.excludeLeadId)
    : loaded.data.appBusy;
  const kind = classifySlot({
    start,
    end,
    calendarKnown: loaded.data.calendarKnown,
    calendarBusy: loaded.data.calendarBusy,
    appMeetings,
    holiday: loaded.data.holidays.includes(brtDateKeyFromInstant(start)),
  });
  const decision = bookingDecision(kind, { allowOverlap: args.allowOverlap === true });
  if (!decision.allow) return { ok: false, error: decision.error, code: decision.code };

  if (args.retargetExisting) {
    const moved = await retargetLeadHold({
      supabase: args.supabase,
      orgId: args.orgId,
      leadId: args.leadId,
      closerId: args.closerId,
      start,
      end,
    });
    if (moved.status === 'updated') return { ok: true, holdId: moved.id };
    if (moved.status === 'conflict') {
      return { ok: false, error: 'Este closer já tem reunião neste horário.', code: 'CLOSER_BUSY' };
    }
    if (moved.status === 'error') {
      console.error('[closer-availability] trava não remanejada', moved.message);
      return { ok: false, error: 'Não foi possível reservar o horário deste closer.', code: 'CLOSER_HOLD' };
    }
    if (moved.status === 'missing') {
      if (fallbackBlocks(appMeetings, start, end)) {
        return { ok: false, error: 'Este closer já tem reunião neste horário.', code: 'CLOSER_BUSY' };
      }
      console.warn('[closer-availability] closer_booking_holds ausente; a trava não é atômica até a migration ser aplicada');
      return { ok: true, holdId: null };
    }
  }

  const inserted = await insertHold({
    supabase: args.supabase,
    orgId: args.orgId,
    closerId: args.closerId,
    leadId: args.leadId,
    userId: args.userId,
    start,
    end,
  });
  const outcome = interpretHoldError(inserted.error);
  if (outcome === 'ok' && inserted.id) return { ok: true, holdId: inserted.id };
  if (outcome === 'conflict') {
    return { ok: false, error: 'Este closer já tem reunião neste horário.', code: 'CLOSER_BUSY' };
  }
  if (outcome === 'table_missing') {
    if (fallbackBlocks(appMeetings, start, end)) {
      return { ok: false, error: 'Este closer já tem reunião neste horário.', code: 'CLOSER_BUSY' };
    }
    console.warn('[closer-availability] closer_booking_holds ausente; a trava não é atômica até a migration ser aplicada');
    return { ok: true, holdId: null };
  }
  console.error('[closer-availability] trava recusada', inserted.error?.message);
  return { ok: false, error: 'Não foi possível reservar o horário deste closer.', code: 'CLOSER_HOLD' };
}

export async function attachCloserHold(supabase: Db, holdId: string, calendarEventId: string): Promise<void> {
  const { error } = await from(supabase, 'closer_booking_holds')
    .update({ calendar_event_id: calendarEventId } as Record<string, unknown>)
    .eq('id', holdId);
  if (error && interpretHoldError(error) !== 'table_missing') {
    console.error('[closer-availability] evento não gravado na trava', error.message);
  }
}

export async function releaseCloserHold(supabase: Db, holdId: string, status: 'released' | 'cancelled'): Promise<void> {
  const { error } = await from(supabase, 'closer_booking_holds')
    .update({ status, released_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', holdId)
    .eq('status', 'held');
  if (error && interpretHoldError(error) !== 'table_missing') {
    console.error('[closer-availability] trava não liberada', error.message);
  }
}

export async function releaseCloserHoldsForMeeting(args: {
  supabase: Db;
  orgId: string;
  closerId: string | null;
  startTime: string | null;
  calendarEventId: string | null;
  status: 'released' | 'cancelled';
  exceptHoldId?: string | null;
}): Promise<void> {
  const patch = { status: args.status, released_at: new Date().toISOString() };
  if (args.calendarEventId) {
    let query = from(args.supabase, 'closer_booking_holds')
      .update(patch as Record<string, unknown>)
      .eq('org_id', args.orgId)
      .eq('calendar_event_id', args.calendarEventId)
      .eq('status', 'held');
    if (args.exceptHoldId) query = query.neq('id', args.exceptHoldId);
    const { error } = await query;
    if (error && interpretHoldError(error) !== 'table_missing') {
      console.error('[closer-availability] trava do evento não liberada', error.message);
    }
  }
  const start = meetingInstant(args.startTime);
  if (!args.closerId || !start) return;
  let query = from(args.supabase, 'closer_booking_holds')
    .update(patch as Record<string, unknown>)
    .eq('org_id', args.orgId)
    .eq('closer_id', args.closerId)
    .eq('slot_start', start.toISOString())
    .eq('status', 'held');
  if (args.exceptHoldId) query = query.neq('id', args.exceptHoldId);
  const { error } = await query;
  if (error && interpretHoldError(error) !== 'table_missing') {
    console.error('[closer-availability] trava do horário não liberada', error.message);
  }
}

/** Desfaz a trava se o Google não chegou a mover o evento. */
export async function revertCloserHold(
  supabase: Db,
  holdId: string,
  previous: { closerId: string; startTime: string; endTime: string | null },
): Promise<void> {
  const start = meetingInstant(previous.startTime);
  const explicitEnd = previous.endTime ? meetingInstant(previous.endTime) : null;
  const end = explicitEnd ?? (start ? new Date(start.getTime() + MEETING_DURATION_MIN * 60_000) : null);
  if (!start || !end) {
    await releaseCloserHold(supabase, holdId, 'released');
    return;
  }
  const { error } = await from(supabase, 'closer_booking_holds')
    .update({
      closer_id: previous.closerId,
      slot_start: start.toISOString(),
      slot_end: end.toISOString(),
    } as Record<string, unknown>)
    .eq('id', holdId)
    .eq('status', 'held');
  if (error) {
    console.error('[closer-availability] trava não voltou ao horário anterior', error.message);
    await releaseCloserHold(supabase, holdId, 'released');
  }
}
