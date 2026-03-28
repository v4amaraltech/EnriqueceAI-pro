'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { createServerSupabaseClient } from '@/lib/supabase/server';

interface SaveDailyGoalsInput {
  orgDefault: number;
  memberGoals: Array<{ userId: string; target: number | null }>;
}

export async function saveDailyGoals(
  input: SaveDailyGoalsInput,
): Promise<ActionResult<{ saved: number }>> {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  const { data: currentMember } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!currentMember) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const orgId = currentMember.org_id;

  if (input.orgDefault < 0) {
    return { success: false, error: 'Meta deve ser maior ou igual a zero' };
  }

  // Upsert org default (user_id = null)
  const { error: orgError } = await supabase
    .from('daily_activity_goals')
    .upsert(
      { org_id: orgId, user_id: null, target: input.orgDefault },
      { onConflict: 'org_id,COALESCE(user_id,\'00000000-0000-0000-0000-000000000000\')' as never },
    );

  if (orgError) {
    // Fallback: try delete + insert for org default
    const { error: delErr } = await supabase
      .from('daily_activity_goals')
      .delete()
      .eq('org_id', orgId)
      .is('user_id', null);
    if (delErr) console.error('[saveDailyGoals] Fallback delete failed:', delErr);

    const { error: insertError } = await supabase
      .from('daily_activity_goals')
      .insert({ org_id: orgId, user_id: null, target: input.orgDefault });

    if (insertError) {
      return { success: false, error: 'Erro ao salvar meta padrão da organização' };
    }
  }

  let saved = 1;

  // Upsert individual member goals
  for (const mg of input.memberGoals) {
    if (mg.target === null) {
      // Remove individual override (use org default)
      const { error: rmErr } = await supabase
        .from('daily_activity_goals')
        .delete()
        .eq('org_id', orgId)
        .eq('user_id', mg.userId);
      if (rmErr) console.error(`[saveDailyGoals] Failed to remove goal for user=${mg.userId}:`, rmErr);
    } else {
      if (mg.target < 0) continue;

      // Delete then insert to handle upsert on computed unique index
      const { error: delMemberErr } = await supabase
        .from('daily_activity_goals')
        .delete()
        .eq('org_id', orgId)
        .eq('user_id', mg.userId);
      if (delMemberErr) console.error(`[saveDailyGoals] Failed to delete goal for user=${mg.userId}:`, delMemberErr);

      const { error } = await supabase
        .from('daily_activity_goals')
        .insert({ org_id: orgId, user_id: mg.userId, target: mg.target });

      if (!error) saved++;
    }
  }

  return { success: true, data: { saved } };
}
