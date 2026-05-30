import { describe, expect, it, vi } from 'vitest';

import {
  fetchActivitiesRanking,
  fetchConversionRanking,
  fetchLeadsFinishedRanking,
  fetchRankingData,
} from './ranking-metrics.service';

// --- Chainable + thenable mock builder ---
function createChainMock(finalResult: unknown = { data: null }) {
  const chain: Record<string, unknown> = {};

  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(finalResult).then(resolve);

  for (const method of ['select', 'eq', 'neq', 'is', 'not', 'in', 'gte', 'gt', 'lte', 'lt', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain);
  }

  chain.maybeSingle = vi.fn(() => Promise.resolve(finalResult));
  chain.single = vi.fn(() => Promise.resolve(finalResult));

  return chain;
}

function createMockSupabase(
  fromImpl: (table: string) => Record<string, unknown>,
  rpcImpl: (fn: string) => Promise<unknown> = () => Promise.resolve({ data: [] }),
) {
  return { from: vi.fn(fromImpl), rpc: vi.fn(rpcImpl) } as unknown;
}

const ORG = 'org-1';
const baseFilters = { month: '2026-01', cadenceIds: [] as string[], userIds: [] as string[] };

describe('fetchLeadsFinishedRanking', () => {
  it('should return 0 when no enrollments', async () => {
    const enrollmentChain = createChainMock({ data: [] });
    const goalsChain = createChainMock({ data: null });

    const supabase = createMockSupabase((table) => {
      if (table === 'cadence_enrollments') return enrollmentChain;
      if (table === 'goals') return goalsChain;
      return createChainMock();
    });

    const result = await fetchLeadsFinishedRanking(supabase as never, ORG, baseFilters);

    expect(result.total).toBe(0);
    expect(result.sdrBreakdown).toHaveLength(0);
  });

  it('should count completed and replied as finished', async () => {
    const sdrsChain = createChainMock({ data: [{ user_id: 'u1' }, { user_id: 'u2' }] });
    const enrollmentChain = createChainMock({
      data: [
        { lead_id: 'l1', enrolled_by: 'u1', status: 'completed' },
        { lead_id: 'l2', enrolled_by: 'u1', status: 'replied' },
        { lead_id: 'l3', enrolled_by: 'u1', status: 'active' },
        { lead_id: 'l4', enrolled_by: 'u2', status: 'completed' },
        { lead_id: 'l5', enrolled_by: 'u2', status: 'bounced' },
      ],
    });
    const leadsChain = createChainMock({
      data: [
        { id: 'l1', assigned_to: 'u1' },
        { id: 'l2', assigned_to: 'u1' },
        { id: 'l3', assigned_to: 'u1' },
        { id: 'l4', assigned_to: 'u2' },
        { id: 'l5', assigned_to: 'u2' },
      ],
    });
    const goalsChain = createChainMock({ data: { leads_finished_target: 10 } });

    const supabase = createMockSupabase((table) => {
      if (table === 'organization_members') return sdrsChain;
      if (table === 'cadence_enrollments') return enrollmentChain;
      if (table === 'leads') return leadsChain;
      if (table === 'goals') return goalsChain;
      return createChainMock();
    });

    const result = await fetchLeadsFinishedRanking(supabase as never, ORG, baseFilters);

    expect(result.total).toBe(3); // 2 from u1 + 1 from u2
    expect(result.monthTarget).toBe(10);
    expect(result.sdrBreakdown).toHaveLength(2);

    const u1 = result.sdrBreakdown.find((s) => s.userId === 'u1');
    expect(u1?.value).toBe(2); // completed + replied
    expect(u1?.secondaryValue).toBe(1); // active = prospecting
  });

  it('should sort breakdown by value descending', async () => {
    const sdrsChain = createChainMock({ data: [{ user_id: 'u1' }, { user_id: 'u2' }] });
    const enrollmentChain = createChainMock({
      data: [
        { lead_id: 'l1', enrolled_by: 'u1', status: 'completed' },
        { lead_id: 'l2', enrolled_by: 'u2', status: 'completed' },
        { lead_id: 'l3', enrolled_by: 'u2', status: 'completed' },
      ],
    });
    const leadsChain = createChainMock({
      data: [
        { id: 'l1', assigned_to: 'u1' },
        { id: 'l2', assigned_to: 'u2' },
        { id: 'l3', assigned_to: 'u2' },
      ],
    });
    const goalsChain = createChainMock({ data: null });

    const supabase = createMockSupabase((table) => {
      if (table === 'organization_members') return sdrsChain;
      if (table === 'cadence_enrollments') return enrollmentChain;
      if (table === 'leads') return leadsChain;
      if (table === 'goals') return goalsChain;
      return createChainMock();
    });

    const result = await fetchLeadsFinishedRanking(supabase as never, ORG, baseFilters);

    expect(result.sdrBreakdown[0]?.userId).toBe('u2');
    expect(result.sdrBreakdown[0]?.value).toBe(2);
  });
});

describe('fetchActivitiesRanking', () => {
  it('should return 0 when no interactions', async () => {
    const sdrsChain = createChainMock({ data: [] });
    const goalsChain = createChainMock({ data: null });

    const supabase = createMockSupabase(
      (table) => {
        if (table === 'organization_members') return sdrsChain;
        if (table === 'goals') return goalsChain;
        return createChainMock();
      },
      () => Promise.resolve({ data: [] }),
    );

    const result = await fetchActivitiesRanking(supabase as never, ORG, baseFilters);

    expect(result.total).toBe(0);
    expect(result.sdrBreakdown).toHaveLength(0);
  });

  it('should count activities per SDR from RPC performer counts', async () => {
    const sdrsChain = createChainMock({ data: [{ user_id: 'u1' }, { user_id: 'u2' }] });
    const goalsChain = createChainMock({ data: { activities_target: 100 } });

    const supabase = createMockSupabase(
      (table) => {
        if (table === 'organization_members') return sdrsChain;
        if (table === 'goals') return goalsChain;
        return createChainMock();
      },
      (fn) => {
        if (fn === 'count_activities_by_performer') {
          return Promise.resolve({
            data: [
              { performer_id: 'u1', cnt: 2 },
              { performer_id: 'u2', cnt: 1 },
            ],
          });
        }
        return Promise.resolve({ data: [] });
      },
    );

    const result = await fetchActivitiesRanking(supabase as never, ORG, baseFilters);

    expect(result.total).toBe(3);
    expect(result.monthTarget).toBe(100);
    expect(result.sdrBreakdown).toHaveLength(2);

    const u1 = result.sdrBreakdown.find((s) => s.userId === 'u1');
    expect(u1?.value).toBe(2);
  });
});

describe('fetchConversionRanking', () => {
  it('should return 0% when no leads', async () => {
    const sdrsChain = createChainMock({ data: [] });
    const goalsChain = createChainMock({ data: null });

    const supabase = createMockSupabase(
      (table) => {
        if (table === 'organization_members') return sdrsChain;
        if (table === 'goals') return goalsChain;
        return createChainMock();
      },
      () => Promise.resolve({ data: [] }),
    );

    const result = await fetchConversionRanking(supabase as never, ORG, baseFilters);

    expect(result.total).toBe(0);
  });

  it('should compute conversion rate per SDR', async () => {
    const sdrsChain = createChainMock({ data: [{ user_id: 'u1' }, { user_id: 'u2' }] });
    const goalsChain = createChainMock({ data: { conversion_target: 30 } });

    // Qualified = won_in_period, attributed to assigned_to (fallback won_by).
    // u1: l1 won, l2 not → 1/2 = 50%. u2: l3 won, l4 not → 1/2 = 50%.
    const supabase = createMockSupabase(
      (table) => {
        if (table === 'organization_members') return sdrsChain;
        if (table === 'goals') return goalsChain;
        return createChainMock();
      },
      (fn) => {
        if (fn === 'fetch_conversion_ranking_data') {
          return Promise.resolve({
            data: [
              { lead_id: 'l1', status: 'qualified', assigned_to: 'u1', won_by: 'u1', won_in_period: true },
              { lead_id: 'l2', status: 'contacted', assigned_to: 'u1', won_by: null, won_in_period: false },
              { lead_id: 'l3', status: 'qualified', assigned_to: 'u2', won_by: 'u2', won_in_period: true },
              { lead_id: 'l4', status: 'new', assigned_to: 'u2', won_by: null, won_in_period: false },
            ],
          });
        }
        return Promise.resolve({ data: [] });
      },
    );

    const result = await fetchConversionRanking(supabase as never, ORG, baseFilters);

    // Overall: 2 won / 4 total = 50%
    expect(result.total).toBe(50);
    expect(result.monthTarget).toBe(30);
    expect(result.sdrBreakdown).toHaveLength(2);

    // u1: 1/2 = 50%, u2: 1/2 = 50%
    const u1 = result.sdrBreakdown.find((s) => s.userId === 'u1');
    expect(u1?.value).toBe(50);
    expect(u1?.secondaryValue).toBe(2); // total leads
  });
});

describe('fetchRankingData', () => {
  it('should return all 3 cards', async () => {
    // Minimal mocks — all return empty data
    const emptyChain = createChainMock({ data: [] });
    const goalsChain = createChainMock({ data: null });

    const supabase = createMockSupabase((table) => {
      if (table === 'goals') return goalsChain;
      return emptyChain;
    });

    const result = await fetchRankingData(supabase as never, ORG, baseFilters);

    expect(result).toHaveProperty('leadsFinished');
    expect(result).toHaveProperty('activitiesDone');
    expect(result).toHaveProperty('conversionRate');
    expect(result.leadsFinished.total).toBe(0);
  });
});
