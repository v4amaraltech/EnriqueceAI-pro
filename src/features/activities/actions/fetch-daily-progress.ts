'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

export interface DailyProgress {
  completed: number;
  pending: number;
  total: number;
  target: number;
}

export async function fetchDailyProgress(): Promise<ActionResult<DailyProgress>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  // Get user's org
  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  // Count today's completed activities (interactions created today by this user)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count: completed } = (await from(supabase, 'interactions')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', member.org_id)
    .eq('performed_by', user.id)
    .gte('created_at', todayStart.toISOString())) as { count: number | null };

  // Count pending activities — must match fetchPendingActivities logic exactly:
  // 1. ALL active enrollments with next_step_due set, excluding auto_email
  // 2. Subtract activities that already have an interaction (already executed)
  const { data: pendingEnrollments } = (await from(supabase, 'cadence_enrollments')
    .select('id, cadence_id, lead_id, current_step, cadence:cadences!inner(type), lead:leads!inner(id)')
    .eq('status', 'active')
    .neq('cadence.type', 'auto_email')
    .not('next_step_due', 'is', null)
    .limit(500)) as { data: Array<{ id: string; cadence_id: string; lead_id: string; current_step: number }> | null };

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
  const { data: userGoal } = (await supabase
    .from('daily_activity_goals')
    .select('target')
    .eq('org_id', member.org_id)
    .eq('user_id', user.id)
    .single()) as { data: { target: number } | null };

  let target = userGoal?.target ?? null;

  if (target === null) {
    const { data: orgGoal } = (await supabase
      .from('daily_activity_goals')
      .select('target')
      .eq('org_id', member.org_id)
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
