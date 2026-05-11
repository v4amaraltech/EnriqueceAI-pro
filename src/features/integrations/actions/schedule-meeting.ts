'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';

import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';
import { sendMeetingBriefingEmail } from '@/features/leads/actions/send-meeting-briefing';
import { createMeetingWhatsAppGroup } from '../services/whatsapp-group.service';

import type { CalendarEvent, CreateEventInput } from '../services/calendar.service';
import {
  checkFreeBusy,
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarConnection,
  updateCalendarEvent,
} from '../services/calendar.service';
import type { BusySlot } from '../services/calendar.service';

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

    // Create WhatsApp group for the meeting (fire-and-forget)
    if (input.closerId) {
      const { data: leadData } = (await from(supabase, 'leads')
        .select('telefone, nome_fantasia, razao_social')
        .eq('id', leadId)
        .single()) as { data: { telefone: string | null; nome_fantasia: string | null; razao_social: string | null } | null };

      if (leadData?.telefone) {
        const startDate = new Date(event.startTime);
        createMeetingWhatsAppGroup(supabase, {
          orgId,
          sdrUserId: userId,
          closerId: input.closerId,
          leadPhone: leadData.telefone,
          leadCompanyName: leadData.nome_fantasia ?? leadData.razao_social ?? 'Lead',
          meetingTitle: input.title,
          meetingDate: startDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long' }),
          meetingTime: `${startDate.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })} (60 min)`,
          meetLink: event.meetLink ?? null,
        }).catch((err) => console.error('[scheduleMeeting] WhatsApp group error:', err));
      }
    }

    revalidatePath('/atividades');
    revalidatePath(`/leads/${leadId}`);

    // Dispatch call.scheduled webhook
    dispatchWebhookEvent(supabase, orgId, 'call.scheduled', {
      lead_id: leadId,
      calendar_event_id: event.id,
      title: input.title,
      start_time: event.startTime,
      end_time: event.endTime,
      meet_link: event.meetLink ?? null,
    }).catch((err) => console.error('[webhook] meeting.scheduled dispatch failed:', err));

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
    .select('id, metadata')
    .eq('id', interactionId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (fetchError || !interaction) {
    return { success: false, error: 'Reunião não encontrada' };
  }

  const meta = interaction.metadata as Record<string, unknown> | null;
  const calendarEventId = meta?.calendar_event_id as string | undefined;

  // Try to delete from Google Calendar (best-effort)
  if (calendarEventId) {
    try {
      const connection = await getCalendarConnection(userId, orgId);
      if (connection) {
        await deleteCalendarEvent(connection, calendarEventId);
      }
    } catch (err) {
      console.warn('[deleteMeeting] Failed to delete from Google Calendar:', err);
    }
  }

  // Delete the interaction record
  const { error: deleteError } = await from(supabase, 'interactions')
    .delete()
    .eq('id', interactionId)
    .eq('org_id', orgId);

  if (deleteError) {
    return { success: false, error: 'Erro ao excluir reunião' };
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

  const connection = await getCalendarConnection(userId, orgId);
  if (!connection) {
    return { success: false, error: 'Google Calendar não conectado. Conecte em Configurações > Integrações.' };
  }

  try {
    let event: CalendarEvent;

    if (calendarEventId) {
      event = await updateCalendarEvent(connection, calendarEventId, input);
    } else {
      // No calendar event yet — create a new one
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
