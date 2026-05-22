'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { from } from '@/lib/supabase/from';

import type { GoalsData } from '../types';

export async function getGoals(month: string): Promise<ActionResult<GoalsData>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const monthDate = `${month}-01`;

  // Compute previous month
  const [y, m] = month.split('-').map(Number) as [number, number];
  const prevDate = new Date(y, m - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-01`;

  // Fetch org-level goal for the selected month
  const { data: orgGoal } = (await from(supabase, 'goals')
    .select('opportunity_target, leads_finished_target, activities_target, conversion_target, leads_opened_target')
    .eq('org_id', orgId)
    .eq('month', monthDate)
    .maybeSingle()) as { data: { opportunity_target: number; leads_finished_target: number | null; activities_target: number | null; conversion_target: number; leads_opened_target: number | null } | null };

  // Fetch active SDRs in the org (no join with auth.users — not accessible via PostgREST)
  const { data: sdrs } = (await from(supabase, 'organization_members')
    .select('user_id, role')
    .eq('org_id', orgId)
    .eq('status', 'active')) as { data: { user_id: string; role: string }[] | null };

  if (!sdrs || sdrs.length === 0) {
    return {
      success: true,
      data: {
        month,
        opportunityTarget: orgGoal?.opportunity_target ?? 0,
        leadsFinishedTarget: orgGoal?.leads_finished_target ?? 0,
        activitiesTarget: orgGoal?.activities_target ?? 0,
        conversionTarget: orgGoal?.conversion_target ?? 0,
        leadsOpenedTarget: orgGoal?.leads_opened_target ?? 0,
        userGoals: [],
      },
    };
  }

  // Fetch user info via admin client (service_role can access auth.users)
  const userInfoMap = new Map<string, { name: string; avatarUrl?: string }>();
  try {
    const adminClient = createAdminSupabaseClient();
    const userIds = sdrs.map((s) => s.user_id);
    await Promise.all(
      userIds.map(async (id) => {
        const { data } = await adminClient.auth.admin.getUserById(id);
        if (data?.user) {
          const u = data.user;
          const meta = u.user_metadata as Record<string, unknown> | undefined;
          const fullName = (meta?.full_name ?? meta?.name ?? '') as string;
          const avatarUrl = (meta?.avatar_url ?? meta?.picture ?? '') as string;
          const displayName = fullName || (u.email ? u.email.split('@')[0]! : u.id.slice(0, 8));
          userInfoMap.set(u.id, { name: displayName, avatarUrl: avatarUrl || undefined });
        }
      }),
    );
  } catch {
    // Fallback: if service_role key is missing, use truncated user_id
  }

  // Fetch user goals for current month
  const { data: currentUserGoals } = (await from(supabase, 'goals_per_user')
    .select('user_id, opportunity_target')
    .eq('org_id', orgId)
    .eq('month', monthDate)) as { data: { user_id: string; opportunity_target: number }[] | null };

  // Fetch user goals for previous month (reference)
  const { data: prevUserGoals } = (await from(supabase, 'goals_per_user')
    .select('user_id, opportunity_target')
    .eq('org_id', orgId)
    .eq('month', prevMonth)) as { data: { user_id: string; opportunity_target: number }[] | null };

  const currentMap = new Map(currentUserGoals?.map((g) => [g.user_id, g.opportunity_target]) ?? []);
  const prevMap = new Map(prevUserGoals?.map((g) => [g.user_id, g.opportunity_target]) ?? []);

  return {
    success: true,
    data: {
      month,
      opportunityTarget: orgGoal?.opportunity_target ?? 0,
      leadsFinishedTarget: orgGoal?.leads_finished_target ?? 0,
      activitiesTarget: orgGoal?.activities_target ?? 0,
      conversionTarget: orgGoal?.conversion_target ?? 0,
      leadsOpenedTarget: orgGoal?.leads_opened_target ?? 0,
      userGoals: sdrs.map((sdr) => {
        const info = userInfoMap.get(sdr.user_id);
        return {
          userId: sdr.user_id,
          userName: info?.name ?? sdr.user_id.slice(0, 8),
          avatarUrl: info?.avatarUrl,
          opportunityTarget: currentMap.get(sdr.user_id) ?? 0,
          previousTarget: prevMap.get(sdr.user_id) ?? null,
        };
      }),
    },
  };
}
