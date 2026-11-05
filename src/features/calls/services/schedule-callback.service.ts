import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { cadenceResumeAfterReturn } from '@/features/activities/utils/callback-resume';
import { logLeadEvent } from '@/features/leads/actions/log-lead-event';

/**
 * Agenda um retorno por telefone SEM sessão de usuário (service role) — usado
 * quando a IA entende que o lead pediu para ligar depois (Power Dialer, nov/2026).
 *
 * Mesmo núcleo da action `scheduleActivity` (activities/actions/schedule-activity.ts):
 * insere `scheduled_activities`, cancela os retornos pendentes anteriores do
 * lead (o mais recente vence) e registra o evento na timeline. Não encerra a
 * cadência e não cria evento no Google Calendar (depende do OAuth do SDR).
 *
 * O retorno combinado manda (mesma regra da story callback-pauses-cadence,
 * PR #463): as cadências ativas do lead ficam pausadas até as 9h BRT do dia
 * útil seguinte ao retorno e retomam sozinhas (`scheduled_start_at`, reativado
 * pelo execute-cadence). O passo da ligação já foi avançado pelo Power Dialer
 * ao concluir — por isso aqui não se avança nada antes de pausar.
 */
export interface ScheduleCallbackInput {
  orgId: string;
  leadId: string;
  /** Dono do retorno (SDR que fez a ligação). */
  userId: string;
  /** ISO UTC. */
  scheduledAt: string;
  notes?: string;
}

export async function scheduleCallbackActivity(
  supabase: SupabaseClient,
  input: ScheduleCallbackInput,
): Promise<{ id: string; cadencePausedUntil?: string }> {
  const { orgId, leadId, userId, scheduledAt, notes } = input;

  const { data, error } = (await from(supabase, 'scheduled_activities' as never)
    .insert({
      org_id: orgId,
      lead_id: leadId,
      user_id: userId,
      channel: 'phone',
      call_provider: null,
      scheduled_at: scheduledAt,
      notes: notes || null,
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (error || !data) {
    throw new Error(`schedule_callback_failed: ${error?.message ?? 'no row'}`);
  }

  await from(supabase, 'scheduled_activities' as never)
    .update({ status: 'cancelled' } as Record<string, unknown>)
    .eq('lead_id', leadId)
    .eq('status', 'pending')
    .neq('id', data.id);

  const dateStr = new Date(scheduledAt).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  });
  await from(supabase, 'interactions').insert({
    org_id: orgId,
    lead_id: leadId,
    channel: 'system',
    type: 'sent',
    message_content: `Atividade agendada: Ligação para ${dateStr}${notes ? ` — ${notes}` : ''}`,
    performed_by: userId,
    metadata: { system_event: 'activity_scheduled', scheduled_activity_id: data.id, scheduled_by: 'ai_call_outcome' },
  } as Record<string, unknown>);

  const cadencePausedUntil = await pauseCadencesUntilReturn(supabase, {
    orgId,
    leadId,
    userId,
    scheduledAt,
    scheduledActivityId: data.id,
  });

  return { id: data.id, ...(cadencePausedUntil ? { cadencePausedUntil } : {}) };
}

/**
 * Pausa as inscrições ATIVAS do lead até a retomada e empurra as já pausadas
 * com retomada agendada mais cedo (nunca encurta; pausa sem data não é tocada).
 * Devolve a data de retomada se pausou/empurrou alguma.
 */
async function pauseCadencesUntilReturn(
  supabase: SupabaseClient,
  params: { orgId: string; leadId: string; userId: string; scheduledAt: string; scheduledActivityId: string },
): Promise<string | undefined> {
  const { orgId, leadId, userId, scheduledAt, scheduledActivityId } = params;
  const resumeAt = cadenceResumeAfterReturn(scheduledAt).toISOString();

  const { data: paused, error: pauseError } = (await from(supabase, 'cadence_enrollments')
    .update({ status: 'paused', scheduled_start_at: resumeAt } as Record<string, unknown>)
    .eq('org_id', orgId)
    .eq('lead_id', leadId)
    .eq('status', 'active')
    .select('id, cadence_id')) as { data: Array<{ id: string; cadence_id: string }> | null; error: { message: string } | null };
  if (pauseError) console.error('[schedule-callback] pause enrollments failed:', pauseError.message, 'leadId=', leadId);

  const { data: extended, error: extendError } = (await from(supabase, 'cadence_enrollments')
    .update({ scheduled_start_at: resumeAt } as Record<string, unknown>)
    .eq('org_id', orgId)
    .eq('lead_id', leadId)
    .eq('status', 'paused')
    .lt('scheduled_start_at', resumeAt)
    .select('id, cadence_id')) as { data: Array<{ id: string; cadence_id: string }> | null; error: { message: string } | null };
  if (extendError) console.error('[schedule-callback] extend paused enrollments failed:', extendError.message, 'leadId=', leadId);

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
      message: `Cadência pausada até ${resumeLabel} — retorno combinado com o lead em ${returnLabel} (IA)`,
      metadata: { cadence_id: enrollment.cadence_id, resume_at: resumeAt, scheduled_activity_id: scheduledActivityId },
    });
  }
  return resumeAt;
}
