'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

/**
 * Save onboarding step progress. Pass null to mark onboarding as complete.
 */
export async function saveOnboardingStep(
  step: number | null,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { error } = await from(supabase, 'organizations')
    .update({ onboarding_step: step } as Record<string, unknown>)
    .eq('id', orgId);

  if (error) {
    return { success: false, error: 'Falha ao salvar progresso' };
  }

  return { success: true, data: undefined };
}
