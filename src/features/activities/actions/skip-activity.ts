'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
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
