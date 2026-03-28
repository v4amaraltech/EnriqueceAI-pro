'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

const enrollmentIdSchema = z.string().uuid('ID inválido');

export async function ignoreActivity(
  enrollmentId: string,
): Promise<ActionResult<void>> {
  const parsed = enrollmentIdSchema.safeParse(enrollmentId);
  if (!parsed.success) return { success: false, error: 'ID inválido' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  const { error } = await from(supabase, 'cadence_enrollments')
    .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', enrollmentId);

  const qErr = handleQueryError(error, 'Erro ao ignorar atividade', 'activities');
  if (qErr) return qErr;

  revalidatePath('/atividades');

  return { success: true, data: undefined };
}
