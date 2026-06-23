'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';

import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';
import { logLeadEvent } from '@/features/leads/actions/log-lead-event';
import { sendMeetingBriefingEmail } from '@/features/leads/actions/send-meeting-briefing';
import { createMeetingWhatsAppGroup } from '../services/whatsapp-group.service';

import type { CalendarEvent, CreateEventInput } from '../services/calendar.service';
import {
  CalendarEventGoneError,
  checkFreeBusy,
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarConnection,
  updateCalendarEvent,
} from '../services/calendar.service';
import type { BusySlot } from '../services/calendar.service';
import { formatMeetingDateTime } from '../utils/format-meeting-datetime';

export async function scheduleMeeting(
  leadId: string,
  input: CreateEventInput,
  faturamentoEstimado: number,
): Promise<ActionResult<CalendarEvent>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  if (!Number.isFinite(faturamentoEstimado) || faturamentoEstimado <= 0) {
    return { success: false, error: 'Informe o faturamento estimado do lead (valor em R$ maior que zero) antes de agendar a reunião.' };
  }

  // Defensive check: client surfaces (LeadScheduleTab, ScheduleMeetingModal)
  // also block on missing required-for-meeting fields, but the server must
  // not trust them — repeat the gate here so a direct API call can't
  // bypass briefing requirements.
  {
    const { data: leadRow } = (await from(supabase, 'leads')
      .select('*')
      .eq('id', leadId)
      .eq('org_id', orgId)
      .single()) as { data: import('@/features/leads/types').LeadRow | null };
    if (leadRow) {
      const [{ getMissingRequiredFields }, { data: cfs }, { data: settings }] = await Promise.all([
        import('@/features/leads/utils/required-field-validation'),
        from(supabase, 'custom_fields').select('*').eq('org_id', orgId) as unknown as Promise<{ data: import('@/features/settings-prospecting/types/custom-field').CustomFieldRow[] | null }>,
        from(supabase, 'standard_field_settings').select('*').eq('org_id', orgId) as unknown as Promise<{ data: import('@/features/settings-prospecting/actions/standard-field-settings').StandardFieldSettingRow[] | null }>,
      ]);
      const missing = getMissingRequiredFields(leadRow, cfs ?? [], settings ?? [], 'meeting');
      if (missing.length > 0) {
        return {
          success: false,
          error: `Preencha os campos obrigatórios antes de agendar: ${missing.map((m) => m.label).join(', ')}`,
          code: 'MISSING_REQUIRED_FIELDS',
        };
      }
    }
  }

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
          `Horário: ${new Date(event.startTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} - ${new Date(event.endTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
        ].filter(Boolean).join('\n'),
        metadata: {
          subject: input.title,
          calendar_event_id: event.id,
          calendar_link: event.htmlLink,
          meet_link: event.meetLink,
          attendees: input.attendeeEmails ?? [],
          closer_id: input.closerId ?? null,
          start_time: input.startTime,
          end_time: input.endTime,
        },
        performed_by: userId,
      } as Record<string, unknown>);

    // Update lead: qualified_at (reunião agendada = qualificado) + closer_id if provided.
    // faturamento_estimado is updated here too — the SDR is required to fill it
    // before scheduling so the closer briefing email has the value populated
    // (96% of briefings were going out with "Faturamento: —" before this gate).
    const leadUpdates: Record<string, unknown> = {
      meeting_scheduled_at: new Date().toISOString(),
      qualified_at: new Date().toISOString(),
      status: 'qualified',
      faturamento_estimado: faturamentoEstimado,
    };
    if (input.closerId) {
      leadUpdates.closer_id = input.closerId;
    }
    await from(supabase, 'leads')
      .update(leadUpdates)
      .eq('id', leadId)
      .eq('org_id', orgId);

    // Complete active/paused cadence enrollments — meeting scheduled means cadence is done
    await from(supabase, 'cadence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('lead_id', leadId)
      .in('status', ['active', 'paused']);

    // Run the post-schedule side-effects via `after()` so the Server Action
    // can return immediately without the Vercel runtime killing pending
    // promises. Without after(), bare .catch() fire-and-forget calls were
    // cancelled mid-flight: V4 Amaral lost the closer briefing email for the
    // Rodobem lead on 2026-05-15 because Resend hadn't responded yet when the
    // action returned.
    const briefingClosed = input.closerId;
    after(async () => {
      if (briefingClosed) {
        try {
          await sendMeetingBriefingEmail(supabase, {
            leadId,
            orgId,
            closerId: briefingClosed,
            sdrUserId: userId,
            meetingTitle: input.title,
            meetingStart: event.startTime,
            meetingEnd: event.endTime,
            meetLink: event.meetLink,
          });
        } catch (err) {
          console.error('[scheduleMeeting] Briefing email error:', err);
        }
      }
    });

    // WhatsApp group creation — also moved under after() for the same reason.
    if (input.closerId) {
      const { data: leadData } = (await from(supabase, 'leads')
        .select('telefone, nome_fantasia, razao_social')
        .eq('id', leadId)
        .single()) as { data: { telefone: string | null; nome_fantasia: string | null; razao_social: string | null } | null };

      if (leadData?.telefone) {
        const startDate = new Date(event.startTime);
        const groupCloserId = input.closerId;
        const groupParams = {
          orgId,
          sdrUserId: userId,
          closerId: groupCloserId,
          leadPhone: leadData.telefone,
          leadCompanyName: leadData.nome_fantasia ?? leadData.razao_social ?? 'Lead',
          meetingTitle: input.title,
          meetingDate: startDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long' }),
          meetingTime: `${startDate.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })} (60 min)`,
          meetLink: event.meetLink ?? null,
        };
        after(async () => {
          try {
            await createMeetingWhatsAppGroup(supabase, groupParams);
          } catch (err) {
            console.error('[scheduleMeeting] WhatsApp group error:', err);
          }
        });
      }
    }

    revalidatePath('/atividades');
    revalidatePath(`/leads/${leadId}`);

    // Dispatch call.scheduled webhook — same after() pattern.
    after(async () => {
      try {
        await dispatchWebhookEvent(supabase, orgId, 'call.scheduled', {
          lead_id: leadId,
          calendar_event_id: event.id,
          title: input.title,
          start_time: event.startTime,
          end_time: event.endTime,
          meet_link: event.meetLink ?? null,
        });
      } catch (err) {
        console.error('[webhook] meeting.scheduled dispatch failed:', err);
      }
    });

    return { success: true, data: event };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao criar evento';
    const code = err instanceof Error && err.name === 'GCalTokenExpired' ? 'GCAL_TOKEN_EXPIRED' : undefined;
    return { success: false, error: message, code };
  }
}

export async function checkCalendarConnected(): Promise<ActionResult<boolean>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId } = auth.data;
  const connection = await getCalendarConnection(userId, orgId);
  return { success: true, data: !!connection };
}

export async function getLeadFaturamento(leadId: string): Promise<ActionResult<number | null>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data } = (await from(supabase, 'leads')
    .select('faturamento_estimado')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { faturamento_estimado: number | null } | null };

  return { success: true, data: data?.faturamento_estimado ?? null };
}

export async function getLoggedUserEmail(): Promise<ActionResult<string>> {
  try {
    const user = await requireAuth();
    return { success: true, data: user.email ?? '' };
  } catch {
    return { success: false, error: 'Usuário não autenticado' };
  }
}

export async function deleteMeeting(
  interactionId: string,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Fetch interaction and validate org ownership
  const { data: interaction, error: fetchError } = await from(supabase, 'interactions')
    .select('id, metadata, lead_id')
    .eq('id', interactionId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (fetchError || !interaction) {
    return { success: false, error: 'Reunião não encontrada' };
  }

  const meta = interaction.metadata as Record<string, unknown> | null;
  const calendarEventId = meta?.calendar_event_id as string | undefined;

  // Delete from Google Calendar. Cancellation still proceeds if this ultimately
  // fails (we don't want a Google outage to block cancelling a meeting), but a
  // single silent failure here used to leave the event orphaned on the calendar
  // forever — which is how Ismael's 09:00 ghost survived. So we now retry and
  // log at error level (was a swallowed `warn`) to make orphans traceable.
  if (calendarEventId) {
    const connection = await getCalendarConnection(userId, orgId);
    if (connection) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await deleteCalendarEvent(connection, calendarEventId);
          break;
        } catch (err) {
          console.error(
            `[deleteMeeting] Google Calendar delete failed (attempt ${attempt}/2) for event ${calendarEventId}:`,
            err,
          );
        }
      }
    }
  }

  const leadId = interaction.lead_id as string | null;

  // Leave a cancellation trace BEFORE deleting the meeting_scheduled row.
  // Otherwise cancelling a meeting erases the only record it ever existed,
  // and the lead stays `qualified` with `meeting_scheduled_at` set forever.
  if (leadId) {
    const startTime = meta?.start_time as string | undefined;
    const whenLabel = startTime ? formatMeetingDateTime(startTime) : null;
    await logLeadEvent(supabase, {
      orgId,
      leadId,
      userId,
      event: 'meeting_cancelled',
      message: whenLabel ? `Reunião cancelada (estava marcada para ${whenLabel})` : 'Reunião cancelada',
    });

    // Clear the now-stale meeting flag so the lead no longer counts as having
    // an upcoming meeting. Status is intentionally left untouched to avoid an
    // unintended downgrade of a lead that may be qualified for other reasons.
    await from(supabase, 'leads')
      .update({ meeting_scheduled_at: null } as Record<string, unknown>)
      .eq('id', leadId)
      .eq('org_id', orgId);
  }

  // Delete the interaction record
  const { error: deleteError } = await from(supabase, 'interactions')
    .delete()
    .eq('id', interactionId)
    .eq('org_id', orgId);

  if (deleteError) {
    return { success: false, error: 'Erro ao excluir reunião' };
  }

  if (leadId) {
    revalidatePath(`/leads/${leadId}`);
  }

  return { success: true, data: undefined };
}

export async function updateMeeting(
  interactionId: string,
  leadId: string,
  input: CreateEventInput,
): Promise<ActionResult<CalendarEvent>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Fetch interaction and validate org ownership
  const { data: interaction, error: fetchError } = await from(supabase, 'interactions')
    .select('id, metadata')
    .eq('id', interactionId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (fetchError || !interaction) {
    return { success: false, error: 'Reunião não encontrada' };
  }

  const meta = interaction.metadata as Record<string, unknown> | null;
  const calendarEventId = meta?.calendar_event_id as string | undefined;
  const previousStartTime = meta?.start_time as string | undefined;

  const connection = await getCalendarConnection(userId, orgId);
  if (!connection) {
    return { success: false, error: 'Google Calendar não conectado. Conecte em Configurações > Integrações.' };
  }

  try {
    let event: CalendarEvent;

    if (calendarEventId) {
      try {
        // Reuse the existing invite — move it in place (PATCH) so the same
        // event and Meet link survive the reschedule.
        event = await updateCalendarEvent(connection, calendarEventId, input);
      } catch (err) {
        if (err instanceof CalendarEventGoneError) {
          // The tracked event was deleted out-of-band (e.g. directly in Google).
          // Recreate it so the reschedule still lands on the calendar instead of
          // throwing and leaving the user thinking it worked.
          console.error(
            `[updateMeeting] Tracked calendar event ${calendarEventId} is gone — recreating for interaction ${interactionId}`,
          );
          event = await createCalendarEvent(connection, input);
        } else {
          throw err;
        }
      }
    } else {
      // No calendar_event_id on an existing meeting means a prior sync dropped
      // the link (and likely left an orphan event on the calendar that nothing
      // tracks anymore). Log it at error level so these silent desyncs are
      // traceable, then create a fresh event for the new time.
      console.error(
        `[updateMeeting] Interaction ${interactionId} had no calendar_event_id — creating a new event (possible orphan on calendar)`,
      );
      event = await createCalendarEvent(connection, input);
    }

    // Update interaction record
    await from(supabase, 'interactions')
      .update({
        message_content: [
          input.title,
          input.description ?? '',
          event.meetLink ? `Google Meet: ${event.meetLink}` : '',
          `Horário: ${new Date(event.startTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} - ${new Date(event.endTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
        ].filter(Boolean).join('\n'),
        metadata: {
          subject: input.title,
          calendar_event_id: event.id,
          calendar_link: event.htmlLink,
          meet_link: event.meetLink,
          attendees: input.attendeeEmails ?? [],
          closer_id: input.closerId ?? null,
          start_time: input.startTime,
          end_time: input.endTime,
        },
      } as Record<string, unknown>)
      .eq('id', interactionId)
      .eq('org_id', orgId);

    // Update closer_id on lead if provided
    if (input.closerId) {
      await from(supabase, 'leads')
        .update({ closer_id: input.closerId } as Record<string, unknown>)
        .eq('id', leadId)
        .eq('org_id', orgId);
    }

    // Reschedule trace: the meeting_scheduled row is mutated in place, so
    // without this the original time is overwritten with no record it moved.
    if (previousStartTime && previousStartTime !== input.startTime) {
      await logLeadEvent(supabase, {
        orgId,
        leadId,
        userId,
        event: 'meeting_rescheduled',
        message: `Reunião remarcada de ${formatMeetingDateTime(previousStartTime)} para ${formatMeetingDateTime(input.startTime)}`,
      });
      revalidatePath(`/leads/${leadId}`);
    }

    return { success: true, data: event };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar evento';
    const code = err instanceof Error && err.name === 'GCalTokenExpired' ? 'GCAL_TOKEN_EXPIRED' : undefined;
    return { success: false, error: message, code };
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
