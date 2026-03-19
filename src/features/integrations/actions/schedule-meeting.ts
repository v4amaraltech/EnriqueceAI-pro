'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';

import type { CalendarEvent, CreateEventInput } from '../services/calendar.service';
import {
  checkFreeBusy,
  createCalendarEvent,
  getCalendarConnection,
} from '../services/calendar.service';
import type { BusySlot } from '../services/calendar.service';

export async function scheduleMeeting(
  leadId: string,
  input: CreateEventInput,
): Promise<ActionResult<CalendarEvent>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const connection = await getCalendarConnection(user.id, member.org_id);
  if (!connection) {
    return { success: false, error: 'Google Calendar não conectado. Conecte em Configurações > Integrações.' };
  }

  try {
    const event = await createCalendarEvent(connection, input);

    // Register interaction as meeting_scheduled
    await from(supabase, 'interactions')
      .insert({
        org_id: member.org_id,
        lead_id: leadId,
        type: 'meeting_scheduled',
        channel: 'calendar',
        direction: 'outbound',
        subject: input.title,
        body: [
          input.description ?? '',
          event.meetLink ? `Google Meet: ${event.meetLink}` : '',
          `Horário: ${new Date(event.startTime).toLocaleString('pt-BR')} - ${new Date(event.endTime).toLocaleString('pt-BR')}`,
        ].filter(Boolean).join('\n'),
        metadata: {
          calendar_event_id: event.id,
          calendar_link: event.htmlLink,
          meet_link: event.meetLink,
          attendees: input.attendeeEmails ?? [],
        },
        performed_by: user.id,
      } as Record<string, unknown>);

    // Dispatch call.scheduled webhook
    dispatchWebhookEvent(supabase, member.org_id, 'call.scheduled', {
      lead_id: leadId,
      calendar_event_id: event.id,
      title: input.title,
      start_time: event.startTime,
      end_time: event.endTime,
      meet_link: event.meetLink ?? null,
    }).catch(() => {});

    return { success: true, data: event };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao criar evento';
    const code = err instanceof Error && err.name === 'GCalTokenExpired' ? 'GCAL_TOKEN_EXPIRED' : undefined;
    return { success: false, error: message, code };
  }
}

export async function getAvailability(
  timeMin: string,
  timeMax: string,
): Promise<ActionResult<BusySlot[]>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const connection = await getCalendarConnection(user.id, member.org_id);
  if (!connection) {
    return { success: false, error: 'Google Calendar não conectado' };
  }

  try {
    const busy = await checkFreeBusy(connection, timeMin, timeMax);
    return { success: true, data: busy };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao verificar disponibilidade';
    const code = err instanceof Error && err.name === 'GCalTokenExpired' ? 'GCAL_TOKEN_EXPIRED' : undefined;
    return { success: false, error: message, code };
  }
}
