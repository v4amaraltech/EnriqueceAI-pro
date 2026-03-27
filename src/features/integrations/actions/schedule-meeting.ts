'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';

import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';
import { sendMeetingBriefingEmail } from '@/features/leads/actions/send-meeting-briefing';

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
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const connection = await getCalendarConnection(userId, orgId);
  if (!connection) {
    return { success: false, error: 'Google Calendar não conectado. Conecte em Configurações > Integrações.' };
  }

  try {
    const event = await createCalendarEvent(connection, input);

    // Register interaction as meeting_scheduled
    await from(supabase, 'interactions')
      .insert({
        org_id: orgId,
        lead_id: leadId,
        type: 'meeting_scheduled',
        channel: 'calendar',
        message_content: [
          input.title,
          input.description ?? '',
          event.meetLink ? `Google Meet: ${event.meetLink}` : '',
          `Horário: ${new Date(event.startTime).toLocaleString('pt-BR')} - ${new Date(event.endTime).toLocaleString('pt-BR')}`,
        ].filter(Boolean).join('\n'),
        metadata: {
          subject: input.title,
          calendar_event_id: event.id,
          calendar_link: event.htmlLink,
          meet_link: event.meetLink,
          attendees: input.attendeeEmails ?? [],
          closer_id: input.closerId ?? null,
        },
        performed_by: userId,
      } as Record<string, unknown>);

    // Save closer_id on lead if provided
    if (input.closerId) {
      await from(supabase, 'leads')
        .update({ closer_id: input.closerId } as Record<string, unknown>)
        .eq('id', leadId)
        .eq('org_id', orgId);
    }

    // Send meeting briefing email to closer (fire-and-forget)
    if (input.closerId) {
      sendMeetingBriefingEmail(supabase, {
        leadId,
        orgId,
        closerId: input.closerId,
        sdrUserId: userId,
        meetingTitle: input.title,
        meetingStart: event.startTime,
        meetingEnd: event.endTime,
        meetLink: event.meetLink,
      }).catch((err) => console.error('[scheduleMeeting] Briefing email error:', err));
    }

    // Dispatch call.scheduled webhook
    dispatchWebhookEvent(supabase, orgId, 'call.scheduled', {
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

export async function getLoggedUserEmail(): Promise<ActionResult<string>> {
  try {
    const user = await requireAuth();
    return { success: true, data: user.email ?? '' };
  } catch {
    return { success: false, error: 'Usuário não autenticado' };
  }
}

export async function getAvailability(
  timeMin: string,
  timeMax: string,
): Promise<ActionResult<BusySlot[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId } = auth.data;

  const connection = await getCalendarConnection(userId, orgId);
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
