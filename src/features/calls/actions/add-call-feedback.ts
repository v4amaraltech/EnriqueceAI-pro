'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { CallFeedbackRow } from '../types';
import { addFeedbackSchema } from '../schemas/call.schemas';

export async function addCallFeedback(
  rawInput: Record<string, unknown>,
): Promise<ActionResult<CallFeedbackRow>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { userId, supabase } = auth.data;

  const parsed = addFeedbackSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const { data, error } = (await from(supabase, 'call_feedback')
    .insert({
      call_id: parsed.data.call_id,
      user_id: userId,
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
