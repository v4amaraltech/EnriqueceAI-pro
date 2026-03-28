'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { updateCallStatusSchema } from '../schemas/call.schemas';

export async function updateCallStatus(
  rawInput: Record<string, unknown>,
): Promise<ActionResult<{ id: string }>> {
  await requireAuth();
  const supabase = await createServerSupabaseClient();

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
