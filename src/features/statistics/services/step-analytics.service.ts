import type { SupabaseClient } from '@supabase/supabase-js';

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
    const { data: enrollments } = (await from(supabase, 'cadence_enrollments')
      .select('lead_id')
      .eq('org_id', orgId)
      .eq('cadence_id', cadenceId)
      .in('enrolled_by', userIds)) as { data: { lead_id: string }[] | null };
    leadIdFilter = (enrollments ?? []).map((e) => e.lead_id);
    if (leadIdFilter.length === 0) {
      return emptyStepData(cadenceId);
    }
  }

  // Build interactions query
  let intQuery = from(supabase, 'interactions')
    .select('step_id, type, lead_id')
    .eq('org_id', orgId)
    .eq('cadence_id', cadenceId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd)
    .not('step_id', 'is', null)
    .in('type', ['sent', 'opened', 'clicked', 'replied', 'meeting_scheduled']);

  if (leadIdFilter) {
    intQuery = intQuery.in('lead_id', leadIdFilter);
  }

  // Steps structure (always all steps for zero-fill)
  const stepsQuery = from(supabase, 'cadence_steps')
    .select('id, step_order, channel, activity_name')
    .eq('cadence_id', cadenceId)
    .order('step_order', { ascending: true });

  const [{ data: rawInteractions }, { data: rawSteps }] = await Promise.all([
    intQuery as unknown as Promise<{ data: StepInteractionRow[] | null }>,
    stepsQuery as unknown as Promise<{ data: CadenceStepRow[] | null }>,
  ]);

  const interactions = rawInteractions ?? [];
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

  const engagedLeadIds = new Set<string>();
  const sentLeadIds = new Set<string>();

  for (const interaction of interactions) {
    if (!interaction.step_id) continue;

    const counts = stepCountMap.get(interaction.step_id) ?? {
      sent: 0, opened: 0, clicked: 0, replied: 0, meetingScheduled: 0,
    };

    switch (interaction.type) {
      case 'sent':
        counts.sent++;
        sentLeadIds.add(interaction.lead_id);
        break;
      case 'opened':
        counts.opened++;
        engagedLeadIds.add(interaction.lead_id);
        break;
      case 'clicked':
        counts.clicked++;
        engagedLeadIds.add(interaction.lead_id);
        break;
      case 'replied':
        counts.replied++;
        engagedLeadIds.add(interaction.lead_id);
        break;
      case 'meeting_scheduled':
        counts.meetingScheduled++;
        engagedLeadIds.add(interaction.lead_id);
        break;
    }

    stepCountMap.set(interaction.step_id, counts);
  }

  const stepMetrics: CadenceStepMetrics[] = steps.map((step) => {
    const counts = stepCountMap.get(step.id) ?? {
      sent: 0, opened: 0, clicked: 0, replied: 0, meetingScheduled: 0,
    };
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
      openRate: safeRate(counts.opened, counts.sent),
      clickRate: safeRate(counts.clicked, counts.sent),
      replyRate: safeRate(counts.replied, counts.sent),
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
