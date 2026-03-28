'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface FitScoreRuleRow {
  id: string;
  org_id: string;
  points: number;
  field: string;
  operator: string;
  value: string | null;
  sort_order: number;
  created_at: string;
}

export async function getFitScoreRules(): Promise<ActionResult<FitScoreRuleRow[]>> {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await from(supabase, 'organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data, error } = (await from(supabase, 'fit_score_rules')
    .select('*')
    .eq('org_id', member.org_id)
    .order('sort_order', { ascending: true })) as { data: FitScoreRuleRow[] | null; error: unknown };

  if (error) return { success: false, error: 'Erro ao carregar regras' };
  return { success: true, data: data ?? [] };
}
