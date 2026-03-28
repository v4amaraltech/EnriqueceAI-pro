'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { recalcFitScoresForOrg } from '@/features/leads/actions/recalc-fit-scores';

import { fitScoreRulesArraySchema, type FitScoreRuleInput } from '../fit-score.schema';

export async function saveFitScoreRules(
  rules: FitScoreRuleInput[],
): Promise<ActionResult<{ saved: number }>> {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  // Validate input
  const parsed = fitScoreRulesArraySchema.safeParse(rules);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? 'Dados inválidos';
    return { success: false, error: firstError };
  }

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const orgId = member.org_id;

  const fitScoreFrom = supabase.from('fit_score_rules');

  // Strategy: delete all existing rules for org, then insert new ones
  // This is simpler and safer than diffing for a small dataset
  const { error: deleteError } = await fitScoreFrom
    .delete()
    .eq('org_id', orgId);

  if (deleteError) {
    return { success: false, error: 'Erro ao atualizar regras' };
  }

  if (parsed.data.length === 0) {
    return { success: true, data: { saved: 0 } };
  }

  const rows = parsed.data.map((rule, i) => ({
    org_id: orgId,
    points: rule.points,
    field: rule.field,
    operator: rule.operator,
    value: rule.operator === 'not_empty' ? null : (rule.value ?? null),
    sort_order: i + 1,
  }));

  const { error: insertError } = await supabase
    .from('fit_score_rules')
    .insert(rows);

  if (insertError) {
    return { success: false, error: 'Erro ao salvar regras' };
  }

  // Trigger batch recalc for all leads in org (fire-and-forget)
  recalcFitScoresForOrg().catch(() => {
    // Background task — don't block the response
  });

  revalidatePath('/settings/prospecting');
  return { success: true, data: { saved: rows.length } };
}
