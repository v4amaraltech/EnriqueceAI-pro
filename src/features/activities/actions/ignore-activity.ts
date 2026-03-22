'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

export async function ignoreActivity(
  enrollmentId: string,
): Promise<ActionResult<void>> {
  await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { error } = await from(supabase, 'cadence_enrollments')
    .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', enrollmentId);

  if (error) {
    console.error('[activities] Failed to ignore activity:', error.message);
    return { success: false, error: 'Erro ao ignorar atividade' };
  }

  revalidatePath('/atividades');

  return { success: true, data: undefined };
}
