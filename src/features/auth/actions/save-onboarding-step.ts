'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Save onboarding step progress. Pass null to mark onboarding as complete.
 */
export async function saveOnboardingStep(
  step: number | null,
): Promise<ActionResult<void>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { error } = await from(supabase, 'organizations')
    .update({ onboarding_step: step } as Record<string, unknown>)
    .eq('id', member.org_id);

  if (error) {
    return { success: false, error: 'Falha ao salvar progresso' };
  }

  return { success: true, data: undefined };
}
