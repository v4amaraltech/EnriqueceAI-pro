'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { CallRow } from '../types';
import { createCallSchema } from '../schemas/call.schemas';

export async function createCall(
  rawInput: Record<string, unknown>,
): Promise<ActionResult<CallRow>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const parsed = createCallSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const { data, error } = (await from(supabase, 'calls')
    .insert({
      ...parsed.data,
      org_id: orgId,
      user_id: userId,
    })
    .select()
    .single()) as { data: CallRow | null; error: { message: string } | null };

  if (error || !data) {
    return { success: false, error: 'Erro ao registrar ligação' };
  }

  revalidatePath('/calls');
  return { success: true, data };
}
