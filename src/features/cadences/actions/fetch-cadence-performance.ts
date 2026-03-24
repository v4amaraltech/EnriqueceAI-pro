'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { safeRate } from '@/features/statistics/types/shared';

import type { CadencePerformanceData, PerformancePeriod } from '../cadences.contract';

interface StepRow {
  id: string;
  step_order: number;
  channel: string;
  activity_name: string | null;
  ab_enabled: boolean;
  ab_winner_variant: string | null;
}

function getPeriodStart(period: PerformancePeriod): string | null {
  if (period === 'all') return null;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function fetchCadencePerformance(
  cadenceId: string,
  period: PerformancePeriod = 'all',
): Promise<ActionResult<CadencePerformanceData>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Fetch cadence info
  const { data: cadence, error: cadenceErr } = await supabase
    .from('cadences')
    .select('id, name, type')
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .single() as { data: { id: string; name: string; type: string } | null; error: { message: string } | null };

  if (cadenceErr || !cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  // Fetch steps (activity_name added via migration, cast to bypass generated types)
  const { data: steps } = (await from(supabase, 'cadence_steps')
    .select('id, step_order, channel, activity_name, ab_enabled, ab_winner_variant')
    .eq('cadence_id', cadenceId)
    .order('step_order')) as { data: StepRow[] | null; error: { message: string } | null };

  // Fetch enrollments
  let enrollmentQuery = supabase
    .from('cadence_enrollments')
    .select('status')
    .eq('cadence_id', cadenceId);

  const periodStart = getPeriodStart(period);
  if (periodStart) {
    enrollmentQuery = enrollmentQuery.gte('enrolled_at', periodStart);
  }

  const { data: enrollments } = await enrollmentQuery;

  // Fetch active enrollments with current_step for pending counts
  const { data: activeEnrollments } = (await from(supabase, 'cadence_enrollments')
    .select('current_step')
    .eq('cadence_id', cadenceId)
    .eq('status', 'active')) as { data: Array<{ current_step: number }> | null; error: { message: string } | null };

  // Build pending-per-step map
  const pendingMap = new Map<number, number>();
  for (const e of activeEnrollments ?? []) {
    pendingMap.set(e.current_step, (pendingMap.get(e.current_step) ?? 0) + 1);
  }

  // Fetch interactions
  let interactionQuery = from(supabase, 'interactions')
    .select('step_id, type')
    .eq('cadence_id', cadenceId)
    .in('type', ['sent', 'opened', 'replied', 'bounced', 'meeting_scheduled']);

  if (periodStart) {
    interactionQuery = interactionQuery.gte('created_at', periodStart);
  }

  const { data: interactions } = (await interactionQuery) as {
    data: Array<{ step_id: string | null; type: string }> | null;
    error: { message: string } | null;
  };

  // Aggregate enrollments
  const enrollmentCounts = {
    active: 0,
    paused: 0,
    completed: 0,
    replied: 0,
    bounced: 0,
    unsubscribed: 0,
    total: 0,
  };
  for (const e of enrollments ?? []) {
    const status = (e as { status: string }).status as keyof typeof enrollmentCounts;
    if (status in enrollmentCounts) {
      enrollmentCounts[status]++;
    }
    enrollmentCounts.total++;
  }

  // Aggregate interactions by step
  const stepMap = new Map<string, { sent: number; opened: number; replied: number; bounced: number }>();
  let totalSent = 0;
  let totalOpened = 0;
  let totalReplied = 0;
  let totalBounced = 0;
  let totalMeetings = 0;

  for (const row of interactions ?? []) {
    if (row.type === 'meeting_scheduled') {
      totalMeetings++;
      continue;
    }

    if (row.type === 'sent') totalSent++;
    if (row.type === 'opened') totalOpened++;
    if (row.type === 'replied') totalReplied++;
    if (row.type === 'bounced') totalBounced++;

    if (row.step_id) {
      let counts = stepMap.get(row.step_id);
      if (!counts) {
        counts = { sent: 0, opened: 0, replied: 0, bounced: 0 };
        stepMap.set(row.step_id, counts);
      }
      const t = row.type as 'sent' | 'opened' | 'replied' | 'bounced';
      if (t in counts) {
        counts[t]++;
      }
    }
  }

  // Build step metrics
  const stepMetrics = (steps ?? []).map((s) => {
    const counts = stepMap.get(s.id) ?? { sent: 0, opened: 0, replied: 0, bounced: 0 };
    const pending = pendingMap.get(s.step_order) ?? 0;
    return {
      stepId: s.id,
      stepOrder: s.step_order,
      channel: s.channel,
      activityName: s.activity_name,
      abEnabled: s.ab_enabled,
      abWinnerVariant: (s.ab_winner_variant as 'A' | 'B' | null) ?? null,
      sent: counts.sent,
      opened: counts.opened,
      replied: counts.replied,
      bounced: counts.bounced,
      pending,
      openRate: safeRate(counts.opened, counts.sent),
      replyRate: safeRate(counts.replied, counts.sent),
      bounceRate: safeRate(counts.bounced, counts.sent),
      completionRate: safeRate(counts.sent, counts.sent + pending),
    };
  });

  return {
    success: true,
    data: {
      cadenceId: cadence.id,
      cadenceName: cadence.name,
      cadenceType: (cadence.type === 'auto_email' ? 'auto_email' : 'standard') as 'standard' | 'auto_email',
      summary: {
        sent: totalSent,
        opened: totalOpened,
        replied: totalReplied,
        bounced: totalBounced,
        meetings: totalMeetings,
        openRate: safeRate(totalOpened, totalSent),
        replyRate: safeRate(totalReplied, totalSent),
        bounceRate: safeRate(totalBounced, totalSent),
        conversionRate: safeRate(enrollmentCounts.replied, enrollmentCounts.total),
      },
      enrollments: enrollmentCounts,
      steps: stepMetrics,
    },
  };
}
