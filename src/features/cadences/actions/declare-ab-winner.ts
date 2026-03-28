'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export async function declareAbWinner(params: {
  stepId: string;
  variant: 'A' | 'B';
}): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Verify step belongs to org via cadence
  const { data: step } = (await from(supabase, 'cadence_steps')
    .select('id, cadence_id, ab_winner_variant')
    .eq('id', params.stepId)
    .single()) as { data: { id: string; cadence_id: string; ab_winner_variant: string | null } | null };

  if (!step) {
    return { success: false, error: 'Step não encontrado' };
  }

  // Idempotent: already declared
  if (step.ab_winner_variant) {
    return { success: true, data: undefined };
  }

  // Verify cadence belongs to org
  const { data: cadence } = await from(supabase, 'cadences')
    .select('id')
    .eq('id', step.cadence_id)
    .eq('org_id', orgId)
    .single();

  if (!cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  // Declare winner: set variant, timestamp, and 100% distribution
  const { error } = await from(supabase, 'cadence_steps')
    .update({
      ab_winner_variant: params.variant,
      ab_winner_at: new Date().toISOString(),
      ab_distribution: params.variant === 'A' ? 100 : 0,
    } as Record<string, unknown>)
    .eq('id', params.stepId);

  if (error) {
    return { success: false, error: 'Erro ao declarar vencedor' };
  }

  return { success: true, data: undefined };
}
