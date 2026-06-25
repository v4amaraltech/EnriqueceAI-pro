import type { SupabaseClient } from '@supabase/supabase-js';

import { chunkedIn } from '@/lib/supabase/chunked-in';
import { from } from '@/lib/supabase/from';

import type { CadenceStepAnalyticsData, CadenceStepMetrics } from '../types/step-analytics';
import { safeRate } from '../types/shared';

interface StepInteractionRow {
  step_id: string | null;
  type: string;
  lead_id: string;
}

interface CadenceStepRow {
  id: string;
  step_order: number;
  channel: string;
  activity_name: string | null;
}

export async function fetchStepAnalyticsData(
  supabase: SupabaseClient,
  orgId: string,
  cadenceId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
): Promise<CadenceStepAnalyticsData> {
  // SDR filter: get lead_ids from enrollments if filtering by user
  let leadIdFilter: string[] | undefined;
  if (userIds && userIds.length > 0) {
    // cadence_enrollments has no org_id — cadence_id already scopes to org
    const { data: enrollments } = (await from(supabase, 'cadence_enrollments')
      .select('lead_id')
      .eq('cadence_id', cadenceId)
      .in('enrolled_by', userIds)) as { data: { lead_id: string }[] | null };
    leadIdFilter = (enrollments ?? []).map((e) => e.lead_id);
    if (leadIdFilter.length === 0) {
      return emptyStepData(cadenceId);
    }
  }

  // Build interactions query
  const buildIntQuery = () =>
    from(supabase, 'interactions')
      .select('step_id, type, lead_id')
      .eq('org_id', orgId)
      .eq('cadence_id', cadenceId)
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd)
      .not('step_id', 'is', null)
      .in('type', ['sent', 'opened', 'clicked', 'replied', 'meeting_scheduled']);

  // Steps structure (always all steps for zero-fill)
  const stepsQuery = from(supabase, 'cadence_steps')
    .select('id, step_order, channel, activity_name')
    .eq('cadence_id', cadenceId)
    .order('step_order', { ascending: true });

  const interactionsPromise: Promise<StepInteractionRow[]> =
    leadIdFilter && leadIdFilter.length > 0
      ? chunkedIn<StepInteractionRow>(leadIdFilter, (chunk) =>
          buildIntQuery()
            .in('lead_id', chunk)
            .limit(10000) as unknown as PromiseLike<{ data: StepInteractionRow[] | null; error: unknown }>,
        )
      : (buildIntQuery().limit(10000) as unknown as Promise<{ data: StepInteractionRow[] | null }>).then(
          (r) => r.data ?? [],
        );

  const [interactions, { data: rawSteps }] = await Promise.all([
    interactionsPromise,
    stepsQuery as unknown as Promise<{ data: CadenceStepRow[] | null }>,
  ]);

  const steps = rawSteps ?? [];

  return buildStepAnalytics(cadenceId, steps, interactions);
}

function buildStepAnalytics(
  cadenceId: string,
  steps: CadenceStepRow[],
  interactions: StepInteractionRow[],
): CadenceStepAnalyticsData {
  const stepCountMap = new Map<string, {
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    meetingScheduled: number;
  }>();

  // Per-step distinct-lead sets power the rates (per prospect, matching the
  // cadence list); the event counts above stay as raw volume.
  const stepLeadMap = new Map<string, {
    sent: Set<string>;
    opened: Set<string>;
    clicked: Set<string>;
    replied: Set<string>;
  }>();

  const engagedLeadIds = new Set<string>();
  const sentLeadIds = new Set<string>();

  for (const interaction of interactions) {
    if (!interaction.step_id) continue;

    const counts = stepCountMap.get(interaction.step_id) ?? {
      sent: 0, opened: 0, clicked: 0, replied: 0, meetingScheduled: 0,
    };
    const leads = stepLeadMap.get(interaction.step_id) ?? {
      sent: new Set<string>(), opened: new Set<string>(), clicked: new Set<string>(), replied: new Set<string>(),
    };

    switch (interaction.type) {
      case 'sent':
        counts.sent++;
        sentLeadIds.add(interaction.lead_id);
        leads.sent.add(interaction.lead_id);
        break;
      case 'opened':
        counts.opened++;
        engagedLeadIds.add(interaction.lead_id);
        leads.opened.add(interaction.lead_id);
        break;
      case 'clicked':
        counts.clicked++;
        engagedLeadIds.add(interaction.lead_id);
        leads.clicked.add(interaction.lead_id);
        break;
      case 'replied':
        counts.replied++;
        engagedLeadIds.add(interaction.lead_id);
        leads.replied.add(interaction.lead_id);
        break;
      case 'meeting_scheduled':
        counts.meetingScheduled++;
        engagedLeadIds.add(interaction.lead_id);
        break;
    }

    stepCountMap.set(interaction.step_id, counts);
    stepLeadMap.set(interaction.step_id, leads);
  }

  const stepMetrics: CadenceStepMetrics[] = steps.map((step) => {
    const counts = stepCountMap.get(step.id) ?? {
      sent: 0, opened: 0, clicked: 0, replied: 0, meetingScheduled: 0,
    };
    const leads = stepLeadMap.get(step.id);
    const sentLeads = leads?.sent.size ?? 0;
    return {
      stepId: step.id,
      stepOrder: step.step_order,
      channel: step.channel,
      activityName: step.activity_name,
      sent: counts.sent,
      opened: counts.opened,
      clicked: counts.clicked,
      replied: counts.replied,
      meetingScheduled: counts.meetingScheduled,
      openRate: safeRate(leads?.opened.size ?? 0, sentLeads),
      clickRate: safeRate(leads?.clicked.size ?? 0, sentLeads),
      replyRate: safeRate(leads?.replied.size ?? 0, sentLeads),
    };
  });

  const totalSent = stepMetrics.reduce((sum, s) => sum + s.sent, 0);

  return {
    cadenceId,
    steps: stepMetrics,
    totalSent,
    engagedLeads: engagedLeadIds.size,
    engagementRate: safeRate(engagedLeadIds.size, sentLeadIds.size),
  };
}

function emptyStepData(cadenceId: string): CadenceStepAnalyticsData {
  return {
    cadenceId,
    steps: [],
    totalSent: 0,
    engagedLeads: 0,
    engagementRate: 0,
  };
}
