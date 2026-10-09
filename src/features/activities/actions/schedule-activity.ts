'use server';

import { revalidatePath } from 'next/cache';

import type { SupabaseClient } from '@supabase/supabase-js';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCalendarConnection, createCalendarEvent } from '@/features/integrations/services/calendar.service';
import { logLeadEvent } from '@/features/leads/actions/log-lead-event';

import { cadenceResumeAfterReturn } from '../utils/callback-resume';

const scheduleActivitySchema = z.object({
  leadId: z.string().uuid(),
  channel: z.enum(['phone', 'whatsapp', 'email', 'linkedin', 'research']),
  // 'whatsapp' quando o retorno é uma Ligação via WhatsApp (channel='phone').
  callProvider: z.enum(['whatsapp']).nullish(),
  scheduledAt: z.string().min(1),
  notes: z.string().optional(),
  // default false: agendar um retorno NÃO encerra a cadência (isso jogava o
  // lead no limbo). Encerrar é explícito. Só true em opt-in deliberado.
  completeEnrollments: z.boolean().default(false),
  // "Pediu para ligar depois": o retorno combinado manda — a cadência fica
  // pausada até o dia útil seguinte ao retorno e retoma sozinha depois.
  pauseCadenceUntilReturn: z.boolean().default(false),
  // Passo de cadência em que a ligação aconteceu (ausente em atividade avulsa).
  // Avançamos ANTES de pausar: o "concluir" do painel também avança em paralelo
  // e o RPC só avança inscrição ativa — sem isto, se a pausa chegasse primeiro,
  // o mesmo passo voltaria na retomada.
  executedStep: z.object({ enrollmentId: z.string().uuid(), stepId: z.string().uuid() }).optional(),
});

export async function scheduleActivity(
  input: z.input<typeof scheduleActivitySchema>,
): Promise<ActionResult<{ id: string; calendarFailed?: boolean; cadencePausedUntil?: string }>> {
  const parsed = scheduleActivitySchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const {
    leadId, channel, callProvider, scheduledAt, notes, completeEnrollments, pauseCadenceUntilReturn, executedStep,
  } = parsed.data;

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

  const serviceClient = createServiceRoleClient();

  // Dedup dos retornos (sempre): ao agendar um novo retorno ("ligar de volta
  // amanhã"), os retornos pendentes anteriores do mesmo lead saem da fila — o
  // mais recente vence. Exclui a linha recém-inserida via .neq('id', data.id).
  // Desacoplado do encerramento de cadência abaixo.
  await from(serviceClient, 'scheduled_activities' as never)
    .update({ status: 'cancelled' } as Record<string, unknown>)
    .eq('lead_id', leadId)
    .eq('status', 'pending')
    .neq('id', data.id);

  // Encerrar a cadência ao agendar um retorno NÃO acontece mais por padrão:
  // isso jogava o lead no limbo (cadência morta ao marcar um follow-up — ex.
  // Danilo Camacho encerrado no passo 1 de 21). Encerrar é sempre explícito
  // (menu "Trocar cadência"/"Encerrar"). Só completa em opt-in deliberado.
  if (completeEnrollments) {
    const { error: enrollError } = await from(serviceClient, 'cadence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('lead_id', leadId)
      .in('status', ['active', 'paused']);
    if (enrollError) {
      console.error('[schedule-activity] Failed to complete enrollments:', enrollError.message, 'leadId=', leadId);
    }
  }

  let cadencePausedUntil: string | undefined;
  if (pauseCadenceUntilReturn && !completeEnrollments) {
    cadencePausedUntil = await pauseCadencesUntilReturn({
      supabase, serviceClient, orgId, userId, leadId, scheduledAt, scheduledActivityId: data.id, executedStep,
    });
  }

  // Record system interaction for timeline
  const channelLabel = returnChannelLabel(channel, callProvider);
  // Fuso explícito: no servidor (UTC) o retorno das 9h aparecia como "12:00".
  const dateStr = new Date(scheduledAt).toLocaleString('pt-BR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
  });
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

  return { success: true, data: { id: data.id, calendarFailed, cadencePausedUntil } };
}

/**
 * Pausa as cadências do lead até o dia útil seguinte ao retorno combinado
 * (story callback-pauses-cadence). Reaproveita a "prospecção agendada": inscrição
 * `paused` + `scheduled_start_at` — o motor (execute-cadence) reativa sozinho na
 * data. Pausada, a inscrição também fica fora do auto-loss por inatividade.
 *
 * Inscrição já pausada com retomada agendada ANTES da nova data é empurrada para
 * a nova data (novo "ligar depois" no retorno); nunca encurta. Pausa sem data
 * (pausa manual/motor) não é tocada. Retorna a data de retomada se pausou algo.
 */
async function pauseCadencesUntilReturn(params: {
  supabase: SupabaseClient;
  serviceClient: SupabaseClient;
  orgId: string;
  userId: string;
  leadId: string;
  scheduledAt: string;
  scheduledActivityId: string;
  executedStep?: { enrollmentId: string; stepId: string };
}): Promise<string | undefined> {
  const { supabase, serviceClient, orgId, userId, leadId, scheduledAt, scheduledActivityId, executedStep } = params;

  if (executedStep) {
    const { error } = await (
      supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: { message: string } | null }>
    )('advance_enrollment_after_step', {
      p_enrollment_id: executedStep.enrollmentId,
      p_executed_step_id: executedStep.stepId,
      p_performed_by: userId,
    });
    if (error) console.error('[schedule-activity] advance before pause failed:', error.message, 'leadId=', leadId);
  }

  const resumeAt = cadenceResumeAfterReturn(scheduledAt).toISOString();

  const { data: paused, error: pauseError } = (await from(serviceClient, 'cadence_enrollments')
    .update({ status: 'paused', scheduled_start_at: resumeAt } as Record<string, unknown>)
    .eq('org_id', orgId)
    .eq('lead_id', leadId)
    .eq('status', 'active')
    .select('id, cadence_id')) as { data: Array<{ id: string; cadence_id: string }> | null; error: { message: string } | null };
  if (pauseError) console.error('[schedule-activity] pause enrollments failed:', pauseError.message, 'leadId=', leadId);

  const { data: extended, error: extendError } = (await from(serviceClient, 'cadence_enrollments')
    .update({ scheduled_start_at: resumeAt } as Record<string, unknown>)
    .eq('org_id', orgId)
    .eq('lead_id', leadId)
    .eq('status', 'paused')
    .lt('scheduled_start_at', resumeAt)
    .select('id, cadence_id')) as { data: Array<{ id: string; cadence_id: string }> | null; error: { message: string } | null };
  if (extendError) console.error('[schedule-activity] extend paused enrollments failed:', extendError.message, 'leadId=', leadId);

  const touched = [...(paused ?? []), ...(extended ?? [])];
  if (touched.length === 0) return undefined;

  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleString('pt-BR', { ...opts, timeZone: 'America/Sao_Paulo' });
  const resumeLabel = fmt(resumeAt, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const returnLabel = fmt(scheduledAt, { dateStyle: 'short', timeStyle: 'short' });

  for (const enrollment of touched) {
    await logLeadEvent(supabase, {
      orgId,
      leadId,
      userId,
      event: 'cadence_paused_for_return',
      message: `Cadência pausada até ${resumeLabel} — retorno combinado com o lead em ${returnLabel}`,
      metadata: { cadence_id: enrollment.cadence_id, resume_at: resumeAt, scheduled_activity_id: scheduledActivityId },
    });
  }
  return resumeAt;
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
