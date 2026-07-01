'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCalendarConnection, createCalendarEvent } from '@/features/integrations/services/calendar.service';

const scheduleActivitySchema = z.object({
  leadId: z.string().uuid(),
  channel: z.enum(['phone', 'whatsapp', 'email', 'linkedin', 'research']),
  // 'whatsapp' quando o retorno é uma Ligação via WhatsApp (channel='phone').
  callProvider: z.enum(['whatsapp']).nullish(),
  scheduledAt: z.string().min(1),
  notes: z.string().optional(),
  completeEnrollments: z.boolean().default(true),
});

export async function scheduleActivity(
  input: z.infer<typeof scheduleActivitySchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = scheduleActivitySchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { leadId, channel, callProvider, scheduledAt, notes, completeEnrollments } = parsed.data;

  // Create scheduled activity
  const { data, error } = (await from(supabase, 'scheduled_activities' as never)
    .insert({
      org_id: orgId,
      lead_id: leadId,
      user_id: userId,
      channel,
      call_provider: callProvider ?? null,
      scheduled_at: scheduledAt,
      notes: notes || null,
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Erro ao agendar atividade' };
  }

  // Complete active cadence enrollments if requested (use service role to bypass RLS)
  if (completeEnrollments) {
    const serviceClient = createServiceRoleClient();
    const { error: enrollError } = await from(serviceClient, 'cadence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('lead_id', leadId)
      .in('status', ['active', 'paused']);
    if (enrollError) {
      console.error('[schedule-activity] Failed to complete enrollments:', enrollError.message, 'leadId=', leadId);
    }

    // Also cancel OTHER pending scheduled activities for the same lead — when
    // the SDR schedules a new return ("ligar de volta amanhã"), older returns
    // for the same lead should drop out of the queue. Excludes the row we
    // just inserted via .neq('id', data.id).
    await from(serviceClient, 'scheduled_activities' as never)
      .update({ status: 'cancelled' } as Record<string, unknown>)
      .eq('lead_id', leadId)
      .eq('status', 'pending')
      .neq('id', data.id);
  }

  // Record system interaction for timeline
  const channelLabel = returnChannelLabel(channel, callProvider);
  const dateStr = new Date(scheduledAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  await from(supabase, 'interactions')
    .insert({
      org_id: orgId,
      lead_id: leadId,
      channel: 'system',
      type: 'sent',
      message_content: `Atividade agendada: ${channelLabel} para ${dateStr}${notes ? ` — ${notes}` : ''}`,
      performed_by: userId,
      metadata: { system_event: 'activity_scheduled', scheduled_activity_id: data.id },
    } as Record<string, unknown>);

  // Create Google Calendar event
  let calendarFailed = false;
  try {
    await createCalendarEventForActivity(userId, orgId, leadId, channelLabel, scheduledAt, notes);
  } catch (err) {
    console.warn('[schedule-activity] Calendar event failed:', err);
    calendarFailed = true;
  }

  revalidatePath('/atividades');
  revalidatePath(`/leads/${leadId}`);

  return {
    success: true,
    data: { id: data.id, calendarFailed },
  } as ActionResult<{ id: string; calendarFailed?: boolean }>;
}

/** Rótulo humano do canal do retorno, considerando a Ligação via WhatsApp. */
function returnChannelLabel(channel: string, callProvider?: 'whatsapp' | null): string {
  if (channel === 'phone' && callProvider === 'whatsapp') return 'Ligação (WhatsApp)';
  const labels: Record<string, string> = {
    phone: 'Ligação', whatsapp: 'WhatsApp', email: 'Email', linkedin: 'LinkedIn', research: 'Pesquisa',
  };
  return labels[channel] ?? channel;
}

async function createCalendarEventForActivity(
  userId: string,
  orgId: string,
  leadId: string,
  channelLabel: string,
  scheduledAt: string,
  notes?: string,
): Promise<void> {
  const connection = await getCalendarConnection(userId, orgId);
  if (!connection) return; // Calendar not connected — skip silently

  // Fetch lead name for event title
  const supabase = await createServerSupabaseClient();
  const { data: lead } = (await from(supabase, 'leads')
    .select('nome_fantasia, razao_social, first_name, last_name')
    .eq('id', leadId)
    .single()) as { data: { nome_fantasia: string | null; razao_social: string | null; first_name: string | null; last_name: string | null } | null };

  const leadName = lead?.nome_fantasia ?? lead?.razao_social ?? [lead?.first_name, lead?.last_name].filter(Boolean).join(' ') ?? 'Lead';

  const startTime = new Date(scheduledAt);
  const endTime = new Date(startTime.getTime() + 15 * 60 * 1000); // 15 min duration

  await createCalendarEvent(connection, {
    title: `${channelLabel}: ${leadName}`,
    description: notes ? `Retorno agendado\n\n${notes}` : 'Retorno agendado via EnriqueceAI',
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  });
}
