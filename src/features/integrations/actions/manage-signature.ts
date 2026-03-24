'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

/**
 * Save or clear a custom email signature.
 * Pass `null` to clear and fall back to Gmail signature.
 */
export async function saveCustomSignature(
  signatureHtml: string | null,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { error } = await from(supabase, 'gmail_connections')
    .update({ custom_signature: signatureHtml } as Record<string, unknown>)
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error) {
    return { success: false, error: 'Erro ao salvar assinatura' };
  }

  return { success: true, data: undefined };
}
