'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
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

  // Get display names via admin client (service_role can access auth.users)
  const nameMap = new Map<string, string>();
  try {
    const adminClient = createAdminSupabaseClient();
    const userIds = members?.map((m) => m.user_id) ?? [];
    await Promise.all(
      userIds.map(async (id) => {
        const { data } = await adminClient.auth.admin.getUserById(id);
        if (data?.user) {
          const u = data.user;
          const meta = u.user_metadata as Record<string, unknown> | undefined;
          const fullName = (meta?.full_name ?? meta?.name ?? '') as string;
          const email = u.email ?? '';
          nameMap.set(u.id, fullName || email.split('@')[0] || u.id.slice(0, 8));
        }
      }),
    );
  } catch {
    // Fallback: if service_role key is missing, truncated user_id used below
  }

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
