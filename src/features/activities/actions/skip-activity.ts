'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

const enrollmentIdSchema = z.string().uuid('ID inválido');

export async function skipActivity(
  enrollmentId: string,
): Promise<ActionResult<{ nextStepDue: string }>> {
  const parsed = enrollmentIdSchema.safeParse(enrollmentId);
  if (!parsed.success) return { success: false, error: 'ID inválido' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  // Look up the current step's configured delay so a skip respects the
  // cadence design. A 2h floor keeps the snooze useful even for delay=0
  // steps (otherwise the same activity would reappear immediately).
  const { data: enrollment } = (await from(supabase, 'cadence_enrollments')
    .select('cadence_id, current_step')
    .eq('id', enrollmentId)
    .single()) as { data: { cadence_id: string; current_step: number } | null };

  let stepDelayMs = 0;
  if (enrollment) {
    const { data: step } = (await from(supabase, 'cadence_steps')
      .select('delay_days, delay_hours')
      .eq('cadence_id', enrollment.cadence_id)
      .eq('step_order', enrollment.current_step)
      .maybeSingle()) as { data: { delay_days: number; delay_hours: number } | null };
    if (step) {
      stepDelayMs = (step.delay_days * 24 + step.delay_hours) * 60 * 60 * 1000;
    }
  }

  const minSnoozeMs = 2 * 60 * 60 * 1000;
  const pushMs = Math.max(minSnoozeMs, stepDelayMs);
  const nextStepDue = new Date(Date.now() + pushMs).toISOString();

  const { error } = await from(supabase, 'cadence_enrollments')
    .update({ next_step_due: nextStepDue } as Record<string, unknown>)
    .eq('id', enrollmentId);

  const qErr = handleQueryError(error, 'Erro ao pular atividade', 'activities');
  if (qErr) return qErr;

  revalidatePath('/atividades');

  return { success: true, data: { nextStepDue } };
}
