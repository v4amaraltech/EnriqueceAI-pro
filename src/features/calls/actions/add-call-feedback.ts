'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { CallFeedbackRow } from '../types';
import { addFeedbackSchema } from '../schemas/call.schemas';

export async function addCallFeedback(
  rawInput: Record<string, unknown>,
): Promise<ActionResult<CallFeedbackRow>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const parsed = addFeedbackSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const { data, error } = (await from(supabase, 'call_feedback')
    .insert({
      call_id: parsed.data.call_id,
      user_id: user.id,
      content: parsed.data.content,
    })
    .select()
    .single()) as { data: CallFeedbackRow | null; error: { message: string } | null };

  if (error || !data) {
    return { success: false, error: 'Erro ao adicionar feedback' };
  }

  revalidatePath('/calls');
  return { success: true, data };
}
