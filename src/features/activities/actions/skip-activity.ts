'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

export async function skipActivity(
  enrollmentId: string,
): Promise<ActionResult<{ nextStepDue: string }>> {
  await requireAuth();
  const supabase = await createServerSupabaseClient();

  const nextStepDue = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  const { error } = await from(supabase, 'cadence_enrollments')
    .update({ next_step_due: nextStepDue } as Record<string, unknown>)
    .eq('id', enrollmentId);

  if (error) {
    console.error('[activities] Failed to skip activity:', error.message);
    return { success: false, error: 'Erro ao pular atividade' };
  }

  revalidatePath('/atividades');

  return { success: true, data: { nextStepDue } };
}
