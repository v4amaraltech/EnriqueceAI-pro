'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { resolveUserProfiles } from '@/lib/auth/user-directory';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface DailyGoalRow {
  id: string;
  user_id: string | null;
  target: number;
}

export interface MemberGoal {
  userId: string;
  name: string;
  role: string;
  target: number | null; // null = uses org default
}

export interface DailyGoalsData {
  orgDefault: number;
  members: MemberGoal[];
}

export async function getDailyGoals(): Promise<ActionResult<DailyGoalsData>> {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  const { data: currentMember } = (await from(supabase, 'organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!currentMember) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const orgId = currentMember.org_id;

  // Get all daily goals for this org
  const { data: goals } = (await from(supabase, 'daily_activity_goals')
    .select('id, user_id, target')
    .eq('org_id', orgId)) as { data: DailyGoalRow[] | null };

  const orgGoal = goals?.find((g) => g.user_id === null);
  const orgDefault = orgGoal?.target ?? 20;

  // Get all active members
  const { data: members } = (await from(supabase, 'organization_members')
    .select('user_id, role')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })) as {
    data: Array<{ user_id: string; role: string }> | null;
  };

  // Display names from auth.users (one query)
  const profiles = await resolveUserProfiles(members?.map((m) => m.user_id) ?? []);
  const nameMap = new Map([...profiles].map(([id, p]) => [id, p.displayName]));

  const memberGoals: MemberGoal[] = (members ?? []).map((m) => {
    const userName = nameMap.get(m.user_id) ?? m.user_id.slice(0, 8);
    const userGoal = goals?.find((g) => g.user_id === m.user_id);

    return {
      userId: m.user_id,
      name: userName,
      role: m.role,
      target: userGoal?.target ?? null,
    };
  });

  return {
    success: true,
    data: { orgDefault, members: memberGoals },
  };
}
