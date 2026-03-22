import { describe, expect, it } from 'vitest';

import { fetchStepAnalyticsData } from '../step-analytics.service';

function createMockSupabase(
  interactions: Record<string, unknown>[],
  steps: Record<string, unknown>[],
) {
  const interactionsChain = {
    select: () => interactionsChain,
    eq: () => interactionsChain,
    gte: () => interactionsChain,
    lte: () => interactionsChain,
    in: () => interactionsChain,
    not: () => interactionsChain,
    then: (resolve: (v: { data: unknown[] }) => void) => resolve({ data: interactions }),
  };

  const stepsChain = {
    select: () => stepsChain,
    eq: () => stepsChain,
    order: () => stepsChain,
    then: (resolve: (v: { data: unknown[] }) => void) => resolve({ data: steps }),
  };

  return {
    from: (table: string) => {
      if (table === 'cadence_steps') return stepsChain;
      return interactionsChain;
    },
  } as never;
}

describe('step-analytics.service', () => {
  it('returns empty data when no steps exist', async () => {
    const supabase = createMockSupabase([], []);
    const result = await fetchStepAnalyticsData(
      supabase,
      'org-1',
      'cadence-1',
      '2024-01-01T00:00:00Z',
      '2024-12-31T23:59:59Z',
    );

    expect(result.cadenceId).toBe('cadence-1');
    expect(result.steps).toHaveLength(0);
    expect(result.totalSent).toBe(0);
    expect(result.engagedLeads).toBe(0);
    expect(result.engagementRate).toBe(0);
  });

  it('zero-fills steps without interactions', async () => {
    const steps = [
      { id: 's1', step_order: 1, channel: 'email', activity_name: 'Intro' },
      { id: 's2', step_order: 2, channel: 'phone', activity_name: null },
    ];

    const supabase = createMockSupabase([], steps);
    const result = await fetchStepAnalyticsData(
      supabase,
      'org-1',
      'cadence-1',
      '2024-01-01T00:00:00Z',
      '2024-12-31T23:59:59Z',
    );

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.sent).toBe(0);
    expect(result.steps[0]?.opened).toBe(0);
    expect(result.steps[0]?.openRate).toBe(0);
    expect(result.steps[1]?.sent).toBe(0);
    expect(result.steps[1]?.channel).toBe('phone');
  });

  it('aggregates interaction counts per step correctly', async () => {
    const steps = [
      { id: 's1', step_order: 1, channel: 'email', activity_name: 'Intro Email' },
      { id: 's2', step_order: 2, channel: 'email', activity_name: 'Follow-up' },
    ];

    const interactions = [
      { step_id: 's1', type: 'sent', lead_id: 'lead-1' },
      { step_id: 's1', type: 'sent', lead_id: 'lead-2' },
      { step_id: 's1', type: 'opened', lead_id: 'lead-1' },
      { step_id: 's1', type: 'clicked', lead_id: 'lead-1' },
      { step_id: 's1', type: 'replied', lead_id: 'lead-2' },
      { step_id: 's2', type: 'sent', lead_id: 'lead-1' },
      { step_id: 's2', type: 'meeting_scheduled', lead_id: 'lead-1' },
    ];

    const supabase = createMockSupabase(interactions, steps);
    const result = await fetchStepAnalyticsData(
      supabase,
      'org-1',
      'cadence-1',
      '2024-01-01T00:00:00Z',
      '2024-12-31T23:59:59Z',
    );

    const step1 = result.steps[0]!;
    expect(step1.sent).toBe(2);
    expect(step1.opened).toBe(1);
    expect(step1.clicked).toBe(1);
    expect(step1.replied).toBe(1);
    expect(step1.meetingScheduled).toBe(0);

    const step2 = result.steps[1]!;
    expect(step2.sent).toBe(1);
    expect(step2.meetingScheduled).toBe(1);
  });

  it('calculates rates correctly', async () => {
    const steps = [
      { id: 's1', step_order: 1, channel: 'email', activity_name: 'Test' },
    ];

    const interactions = [
      { step_id: 's1', type: 'sent', lead_id: 'lead-1' },
      { step_id: 's1', type: 'sent', lead_id: 'lead-2' },
      { step_id: 's1', type: 'sent', lead_id: 'lead-3' },
      { step_id: 's1', type: 'sent', lead_id: 'lead-4' },
      { step_id: 's1', type: 'opened', lead_id: 'lead-1' },
      { step_id: 's1', type: 'opened', lead_id: 'lead-2' },
      { step_id: 's1', type: 'replied', lead_id: 'lead-1' },
    ];

    const supabase = createMockSupabase(interactions, steps);
    const result = await fetchStepAnalyticsData(
      supabase,
      'org-1',
      'cadence-1',
      '2024-01-01T00:00:00Z',
      '2024-12-31T23:59:59Z',
    );

    const step = result.steps[0]!;
    expect(step.openRate).toBe(50); // 2/4 = 50%
    expect(step.replyRate).toBe(25); // 1/4 = 25%
    expect(step.clickRate).toBe(0); // 0/4 = 0%
  });

  it('computes unique engaged leads across all steps', async () => {
    const steps = [
      { id: 's1', step_order: 1, channel: 'email', activity_name: null },
      { id: 's2', step_order: 2, channel: 'email', activity_name: null },
    ];

    const interactions = [
      { step_id: 's1', type: 'sent', lead_id: 'lead-1' },
      { step_id: 's1', type: 'sent', lead_id: 'lead-2' },
      { step_id: 's1', type: 'sent', lead_id: 'lead-3' },
      { step_id: 's1', type: 'opened', lead_id: 'lead-1' },
      { step_id: 's2', type: 'sent', lead_id: 'lead-1' },
      { step_id: 's2', type: 'replied', lead_id: 'lead-1' }, // same lead, still 1 engaged
      { step_id: 's2', type: 'opened', lead_id: 'lead-2' },
    ];

    const supabase = createMockSupabase(interactions, steps);
    const result = await fetchStepAnalyticsData(
      supabase,
      'org-1',
      'cadence-1',
      '2024-01-01T00:00:00Z',
      '2024-12-31T23:59:59Z',
    );

    expect(result.totalSent).toBe(4); // 4 sent interactions total
    expect(result.engagedLeads).toBe(2); // lead-1 and lead-2 (unique)
    expect(result.engagementRate).toBe(66.7); // 2/3 unique sent leads
  });
});
