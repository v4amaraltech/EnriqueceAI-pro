'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { logLeadEvent } from '@/features/leads/actions/log-lead-event';

const schema = z.object({
  scheduledActivityId: z.string().uuid(),
  action: z.enum(['completed', 'cancelled']),
});

export async function completeScheduledActivity(
  scheduledActivityId: string,
  action: 'completed' | 'cancelled' = 'completed',
): Promise<ActionResult<void>> {
  const parsed = schema.safeParse({ scheduledActivityId, action });
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { data: scheduled } = (await from(supabase, 'scheduled_activities' as never)
    .select('lead_id, channel')
    .eq('id', scheduledActivityId)
    .maybeSingle()) as { data: { lead_id: string; channel: string } | null };

  const { error } = await from(supabase, 'scheduled_activities' as never)
    .update({
      status: action,
      completed_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', scheduledActivityId);

  const qErr = handleQueryError(error, 'Erro ao atualizar atividade agendada', 'activities');
  if (qErr) return qErr;

  if (scheduled?.lead_id) {
    await logLeadEvent(supabase, {
      orgId,
      leadId: scheduled.lead_id,
      userId,
      event: action === 'cancelled' ? 'scheduled_activity_cancelled' : 'scheduled_activity_completed',
      message: action === 'cancelled'
        ? `Atividade agendada (${scheduled.channel}) cancelada`
        : `Atividade agendada (${scheduled.channel}) concluída`,
    });
  }

  revalidatePath('/atividades');

  return { success: true, data: undefined };
}

export async function postponeScheduledActivity(
  scheduledActivityId: string,
): Promise<ActionResult<void>> {
  const parsed = z.string().uuid().safeParse(scheduledActivityId);
  if (!parsed.success) return { success: false, error: 'ID inválido' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const newTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  const { data: scheduled } = (await from(supabase, 'scheduled_activities' as never)
    .select('lead_id, channel')
    .eq('id', scheduledActivityId)
    .maybeSingle()) as { data: { lead_id: string; channel: string } | null };

  const { error } = await from(supabase, 'scheduled_activities' as never)
    .update({ scheduled_at: newTime } as Record<string, unknown>)
    .eq('id', scheduledActivityId);

  const qErr = handleQueryError(error, 'Erro ao adiar atividade', 'activities');
  if (qErr) return qErr;

  if (scheduled?.lead_id) {
    await logLeadEvent(supabase, {
      orgId,
      leadId: scheduled.lead_id,
      userId,
      event: 'activity_postponed',
      message: `Atividade agendada (${scheduled.channel}) adiada em 2h`,
      metadata: { scheduled_at: newTime },
    });
  }

  revalidatePath('/atividades');

  return { success: true, data: undefined };
}
