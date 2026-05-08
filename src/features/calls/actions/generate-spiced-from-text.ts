'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { analyzeAndSaveSpiced } from '../services/transcription.service';

const inputSchema = z.object({
  leadId: z.string().uuid(),
  text: z.string().min(50, 'Resumo precisa ter ao menos 50 caracteres').max(20000),
});

export async function generateSpicedFromText(
  rawInput: Record<string, unknown>,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId } = auth.data;

  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const supabase = createServiceRoleClient();

  try {
    await analyzeAndSaveSpiced(supabase, orgId, parsed.data.leadId, parsed.data.text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    console.error('[generateSpicedFromText] Error:', msg);
    return { success: false, error: 'Falha ao gerar SPICED. Tente novamente.' };
  }

  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { success: true, data: undefined };
}
