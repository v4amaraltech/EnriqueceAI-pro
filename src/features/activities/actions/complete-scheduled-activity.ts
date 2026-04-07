'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

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
  const { supabase } = auth.data;

  const { error } = await from(supabase, 'scheduled_activities' as never)
    .update({
      status: action,
      completed_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', scheduledActivityId);

  const qErr = handleQueryError(error, 'Erro ao atualizar atividade agendada', 'activities');
  if (qErr) return qErr;

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
  const { supabase } = auth.data;

  const newTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  const { error } = await from(supabase, 'scheduled_activities' as never)
    .update({ scheduled_at: newTime } as Record<string, unknown>)
    .eq('id', scheduledActivityId);

  const qErr = handleQueryError(error, 'Erro ao adiar atividade', 'activities');
  if (qErr) return qErr;

  revalidatePath('/atividades');

  return { success: true, data: undefined };
}
