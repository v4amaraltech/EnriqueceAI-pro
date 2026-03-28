'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { updateCallStatusSchema } from '../schemas/call.schemas';

export async function updateCallStatus(
  rawInput: Record<string, unknown>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  const parsed = updateCallStatusSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: 'Dados inválidos' };
  }

  const { error } = await from(supabase, 'calls')
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq('id', parsed.data.id);

  if (error) {
    return { success: false, error: 'Erro ao atualizar status' };
  }

  revalidatePath('/calls');
  return { success: true, data: { id: parsed.data.id } };
}
