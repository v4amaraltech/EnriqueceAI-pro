'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { saveGoalsSchema, type SaveGoalsInput } from '../schemas/goals.schema';

export async function saveGoals(input: SaveGoalsInput): Promise<ActionResult<{ saved: true }>> {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  // Validate
  const parsed = saveGoalsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const { month, opportunityTarget, leadsFinishedTarget, activitiesTarget, conversionTarget, leadsOpenedTarget, meetingsScheduledTarget, meetingsHeldTarget, userGoals } = parsed.data;
  const monthDate = `${month}-01`;

  // Get user's org
  const { data: member } = (await from(supabase, 'organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  // Upsert org-level goal
  const { error: goalError } = await from(supabase, 'goals')
    .upsert(
      {
        org_id: member.org_id,
        month: monthDate,
        opportunity_target: opportunityTarget,
        leads_finished_target: leadsFinishedTarget,
        activities_target: activitiesTarget,
        conversion_target: conversionTarget,
        leads_opened_target: leadsOpenedTarget,
        meetings_scheduled_target: meetingsScheduledTarget,
        meetings_held_target: meetingsHeldTarget,
        created_by: user.id,
      },
      { onConflict: 'org_id,month' },
    );

  if (goalError) {
    return { success: false, error: 'Erro ao salvar meta da organização' };
  }

  // Upsert user goals
  const userGoalRows = userGoals.map((ug) => ({
    org_id: member.org_id,
    user_id: ug.userId,
    month: monthDate,
    opportunity_target: ug.opportunityTarget,
  }));

  const { error: userGoalError } = await from(supabase, 'goals_per_user')
    .upsert(userGoalRows, {
      onConflict: 'org_id,user_id,month',
    });

  if (userGoalError) {
    return { success: false, error: 'Erro ao salvar metas individuais' };
  }

  revalidatePath('/dashboard');
  return { success: true, data: { saved: true } };
}
