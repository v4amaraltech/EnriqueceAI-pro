'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { chunkedIn } from '@/lib/supabase/chunked-in';
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
  // BRT midnight: shift "now" by -3h then truncate to UTC midnight, shift back
  const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const todayStart = new Date(Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate()) + 3 * 60 * 60 * 1000);

  // Filter to channels the SDR actually performs. `system` covers automated
  // events (csv_import bulk-logs, soft-deletes, etc) that all carry the
  // SDR's user id in performed_by but aren't real activities — Rafael saw
  // 102 "atividades" today when 46 came from a single CSV import at 12:55
  // and 50 more were system events; only 6 were real (phone, whatsapp,
  // research). Keep only the user-driven channels so the daily target
  // reflects what the SDR actually did.
  const SDR_CHANNELS = ['email', 'whatsapp', 'phone', 'linkedin', 'research'];

  const { count: completed } = (await from(supabase, 'interactions')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('performed_by', userId)
    .in('channel', SDR_CHANNELS)
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
    const nowIso = new Date().toISOString();
    pendingEnrollments = await chunkedIn<{ id: string; cadence_id: string; lead_id: string; current_step: number }>(
      myLeadIds,
      (chunk) =>
        from(supabase, 'cadence_enrollments')
          .select('id, cadence_id, lead_id, current_step')
          .eq('status', 'active')
          .in('lead_id', chunk)
          .not('next_step_due', 'is', null)
          .lte('next_step_due', nowIso)
          .limit(500) as unknown as PromiseLike<{
          data: Array<{ id: string; cadence_id: string; lead_id: string; current_step: number }> | null;
          error: unknown;
        }>,
    );
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

      const existingInteractions = await chunkedIn<{ cadence_id: string; step_id: string; lead_id: string }>(
        leadIds,
        (chunk) =>
          from(supabase, 'interactions')
            .select('cadence_id, step_id, lead_id')
            .in('cadence_id', cadenceIds)
            .in('step_id', stepIds)
            .in('lead_id', chunk) as unknown as PromiseLike<{
            data: Array<{ cadence_id: string; step_id: string; lead_id: string }> | null;
            error: unknown;
          }>,
      );

      const executedSet = new Set(
        existingInteractions.map((i) => `${i.cadence_id}:${i.step_id}:${i.lead_id}`),
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
