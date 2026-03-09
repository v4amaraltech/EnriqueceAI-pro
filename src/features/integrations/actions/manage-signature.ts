'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Save or clear a custom email signature.
 * Pass `null` to clear and fall back to Gmail signature.
 */
export async function saveCustomSignature(
  signatureHtml: string | null,
): Promise<ActionResult<void>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { error } = await from(supabase, 'gmail_connections')
    .update({ custom_signature: signatureHtml } as Record<string, unknown>)
    .eq('org_id', member.org_id)
    .eq('user_id', user.id);

  if (error) {
    return { success: false, error: 'Erro ao salvar assinatura' };
  }

  return { success: true, data: undefined };
}
