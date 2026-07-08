import { describe, expect, it, vi } from 'vitest';

import {
  fetchActivitiesRanking,
  fetchAttendanceRateRanking,
  fetchLeadsFinishedRanking,
  fetchMeetingsHeldRanking,
  fetchRankingData,
} from './ranking-metrics.service';
import type { RankingCardData } from '../types';

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

describe('fetchAttendanceRateRanking', () => {
  const card = (
    total: number,
    monthTarget: number,
    sdrBreakdown: RankingCardData['sdrBreakdown'],
  ): RankingCardData => ({ total, monthTarget, percentOfTarget: 0, averagePerSdr: 0, sdrBreakdown });

  it('should return 0% when no meetings', () => {
    const result = fetchAttendanceRateRanking(card(0, 0, []), card(0, 0, []));
    expect(result.total).toBe(0);
    expect(result.sdrBreakdown).toHaveLength(0);
  });

  it('should compute attendance rate per SDR (realizadas ÷ marcadas)', () => {
    // Marcadas: u1=4, u2=2. Realizadas: u1=2, u2=2.
    const scheduled = card(6, 10, [
      { userId: 'u1', userName: '', value: 4 },
      { userId: 'u2', userName: '', value: 2 },
    ]);
    const held = card(4, 5, [
      { userId: 'u1', userName: '', value: 2 },
      { userId: 'u2', userName: '', value: 2 },
    ]);

    const result = fetchAttendanceRateRanking(scheduled, held);

    // Overall: 4 realizadas / 6 marcadas = 67%
    expect(result.total).toBe(67);
    // Meta derivada: held.monthTarget / scheduled.monthTarget = 5/10 = 50%
    expect(result.monthTarget).toBe(50);
    expect(result.sdrBreakdown).toHaveLength(2);

    // u1: 2/4 = 50% (secondaryValue = realizadas), u2: 2/2 = 100%
    const u1 = result.sdrBreakdown.find((s) => s.userId === 'u1');
    expect(u1?.value).toBe(50);
    expect(u1?.secondaryValue).toBe(2);
    const u2 = result.sdrBreakdown.find((s) => s.userId === 'u2');
    expect(u2?.value).toBe(100);
  });
});

describe('fetchMeetingsHeldRanking — idealToDate (divisor por meta individual)', () => {
  it('divides the org target only by SDRs with an individual goal > 0', async () => {
    // Past month (2026-01) → pace is fully elapsed, so ideal = target / divisor.
    // 5 SDRs ativos, mas só 4 têm meta individual (u5 = 0) → divisor 4.
    const sdrsChain = createChainMock({
      data: [
        { user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' }, { user_id: 'u4' }, { user_id: 'u5' },
      ],
    });
    const leadsChain = createChainMock({
      data: [
        { id: 'l1', assigned_to: 'u1' },
        { id: 'l2', assigned_to: 'u1' },
        { id: 'l3', assigned_to: 'u2' },
      ],
    });
    const goalsChain = createChainMock({ data: { meetings_held_target: 100 } });
    const goalsPerUserChain = createChainMock({
      data: [
        { user_id: 'u1', opportunity_target: 10 },
        { user_id: 'u2', opportunity_target: 10 },
        { user_id: 'u3', opportunity_target: 10 },
        { user_id: 'u4', opportunity_target: 10 },
        { user_id: 'u5', opportunity_target: 0 },
      ],
    });

    const supabase = createMockSupabase((table) => {
      if (table === 'organization_members') return sdrsChain;
      if (table === 'leads') return leadsChain;
      if (table === 'goals') return goalsChain;
      if (table === 'goals_per_user') return goalsPerUserChain;
      return createChainMock();
    });

    const result = await fetchMeetingsHeldRanking(supabase as never, ORG, baseFilters);

    expect(result.total).toBe(3);
    expect(result.monthTarget).toBe(100);
    // Divisor = 4 (u5 sem meta individual não conta) → 100 / 4 = 25 (mês passado = meta cheia).
    expect(result.idealToDate).toBe(25);
  });

  it('falls back to all active SDRs when none have an individual goal', async () => {
    const sdrsChain = createChainMock({ data: [{ user_id: 'u1' }, { user_id: 'u2' }] });
    const leadsChain = createChainMock({ data: [{ id: 'l1', assigned_to: 'u1' }] });
    const goalsChain = createChainMock({ data: { meetings_held_target: 100 } });
    const goalsPerUserChain = createChainMock({ data: [] }); // ninguém com meta individual

    const supabase = createMockSupabase((table) => {
      if (table === 'organization_members') return sdrsChain;
      if (table === 'leads') return leadsChain;
      if (table === 'goals') return goalsChain;
      if (table === 'goals_per_user') return goalsPerUserChain;
      return createChainMock();
    });

    const result = await fetchMeetingsHeldRanking(supabase as never, ORG, baseFilters);

    // Fallback: divisor = 2 SDRs ativos → 100 / 2 = 50.
    expect(result.idealToDate).toBe(50);
  });

  it('uses each SDR individual meetings target for per-SDR idealToDate (fallback to shared)', async () => {
    // Mês passado (2026-01) → pace cheio, ideal = meta (sem paceamento parcial).
    // u1 tem meta individual de reuniões (16) → ideal próprio = 16.
    // u2 tem meta individual = 0 → cai no ideal compartilhado (100 / 3 = 33).
    const sdrsChain = createChainMock({
      data: [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' }],
    });
    const leadsChain = createChainMock({
      data: [
        { id: 'l1', assigned_to: 'u1' },
        { id: 'l2', assigned_to: 'u1' },
        { id: 'l3', assigned_to: 'u2' },
      ],
    });
    const goalsChain = createChainMock({ data: { meetings_held_target: 100 } });
    // Mesmo chain serve countSdrsForIdeal (opportunity_target) e
    // fetchIndividualMeetingTargets (meetings_held_target) — inclui ambos os campos.
    const goalsPerUserChain = createChainMock({
      data: [
        { user_id: 'u1', opportunity_target: 10, meetings_held_target: 16 },
        { user_id: 'u2', opportunity_target: 10, meetings_held_target: 0 },
        { user_id: 'u3', opportunity_target: 10, meetings_held_target: 30 },
      ],
    });

    const supabase = createMockSupabase((table) => {
      if (table === 'organization_members') return sdrsChain;
      if (table === 'leads') return leadsChain;
      if (table === 'goals') return goalsChain;
      if (table === 'goals_per_user') return goalsPerUserChain;
      return createChainMock();
    });

    const result = await fetchMeetingsHeldRanking(supabase as never, ORG, baseFilters);

    const u1 = result.sdrBreakdown.find((s) => s.userId === 'u1');
    const u2 = result.sdrBreakdown.find((s) => s.userId === 'u2');
    // u1: meta individual 16 (mês cheio) → ideal próprio 16, diferente dos demais.
    expect(u1?.idealToDate).toBe(16);
    // u2: sem meta individual → fallback compartilhado = 100 / 3 SDRs ≈ 33.
    expect(u2?.idealToDate).toBe(33);
    // u3 tem meta individual (30) mas 0 reuniões → não aparece no breakdown.
    expect(result.sdrBreakdown.find((s) => s.userId === 'u3')).toBeUndefined();
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
    expect(result).toHaveProperty('attendanceRate');
    expect(result.leadsFinished.total).toBe(0);
  });
});
