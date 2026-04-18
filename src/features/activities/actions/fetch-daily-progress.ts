'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export interface DailyProgress {
  completed: number;
  pending: number;
  total: number;
  target: number;
}

export async function fetchDailyProgress(): Promise<ActionResult<DailyProgress>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Count today's completed activities (interactions created today by this user)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count: completed } = (await from(supabase, 'interactions')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('performed_by', userId)
    .gte('created_at', todayStart.toISOString())) as { count: number | null };

  // Count pending activities for THIS SDR only:
  // Step 1: Get lead IDs assigned to this user
  const { data: myLeads } = (await from(supabase, 'leads')
    .select('id')
    .eq('org_id', orgId)
    .eq('assigned_to', userId)
    .is('deleted_at', null)
    .limit(1000)) as { data: Array<{ id: string }> | null };

  const myLeadIds = (myLeads ?? []).map((l) => l.id);

  // Step 2: Get active enrollments for MY leads only
  let pendingEnrollments: Array<{ id: string; cadence_id: string; lead_id: string; current_step: number }> | null = null;

  if (myLeadIds.length > 0) {
    const { data } = (await from(supabase, 'cadence_enrollments')
      .select('id, cadence_id, lead_id, current_step')
      .eq('status', 'active')
      .in('lead_id', myLeadIds)
      .not('next_step_due', 'is', null)
      .lte('next_step_due', new Date().toISOString())
      .limit(500)) as { data: Array<{ id: string; cadence_id: string; lead_id: string; current_step: number }> | null };
    pendingEnrollments = data;
  }

  let pending: number | null = 0;

  if (pendingEnrollments && pendingEnrollments.length > 0) {
    // Fetch matching steps to get step IDs for dedup
    const cadenceIds = [...new Set(pendingEnrollments.map((e) => e.cadence_id))];
    const { data: steps } = (await from(supabase, 'cadence_steps')
      .select('id, cadence_id, step_order')
      .in('cadence_id', cadenceIds)) as { data: Array<{ id: string; cadence_id: string; step_order: number }> | null };

    const stepMap = new Map<string, string>(); // "cadence_id:step_order" → step_id
    for (const s of steps ?? []) {
      stepMap.set(`${s.cadence_id}:${s.step_order}`, s.id);
    }

    // Build candidates with step IDs
    const candidates = pendingEnrollments
      .map((e) => ({
        cadenceId: e.cadence_id,
        stepId: stepMap.get(`${e.cadence_id}:${e.current_step}`),
        leadId: e.lead_id,
      }))
      .filter((c): c is { cadenceId: string; stepId: string; leadId: string } => !!c.stepId);

    if (candidates.length > 0) {
      const stepIds = [...new Set(candidates.map((c) => c.stepId))];
      const leadIds = [...new Set(candidates.map((c) => c.leadId))];

      const { data: existingInteractions } = (await from(supabase, 'interactions')
        .select('cadence_id, step_id, lead_id')
        .in('cadence_id', cadenceIds)
        .in('step_id', stepIds)
        .in('lead_id', leadIds)) as { data: Array<{ cadence_id: string; step_id: string; lead_id: string }> | null };

      const executedSet = new Set(
        (existingInteractions ?? []).map((i) => `${i.cadence_id}:${i.step_id}:${i.lead_id}`),
      );

      pending = candidates.filter((c) => !executedSet.has(`${c.cadenceId}:${c.stepId}:${c.leadId}`)).length;
    } else {
      pending = 0;
    }
  }

  // Get daily goal: user-specific first, fallback to org default (user_id IS NULL)
  const { data: userGoal } = (await from(supabase, 'daily_activity_goals')
    .select('target')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single()) as { data: { target: number } | null };

  let target = userGoal?.target ?? null;

  if (target === null) {
    const { data: orgGoal } = (await from(supabase, 'daily_activity_goals')
      .select('target')
      .eq('org_id', orgId)
      .is('user_id', null)
      .single()) as { data: { target: number } | null };

    target = orgGoal?.target ?? 20; // default 20
  }

  const comp = completed ?? 0;
  const pend = pending ?? 0;

  return {
    success: true,
    data: {
      completed: comp,
      pending: pend,
      total: comp + pend,
      target,
    },
  };
}
