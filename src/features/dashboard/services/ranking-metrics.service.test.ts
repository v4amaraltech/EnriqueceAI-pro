import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchActivitiesRanking,
  fetchAttendanceRateRanking,
  fetchLeadsFinishedRanking,
  fetchLeadsOpenedRanking,
  fetchLeadsToOpenRanking,
  fetchHeldLeadsForRanking,
  fetchMeetingsHeldRanking,
  fetchRankingData,
  fetchSaoRanking,
  fetchSaoRateRanking,
} from './ranking-metrics.service';
import type { RankingCardData } from '../types';
import { meetingsHeldWindowFilter } from '../utils/meetings-held-window';

// --- Chainable + thenable mock builder ---
function createChainMock(finalResult: unknown = { data: null }) {
  const chain: Record<string, unknown> = {};

  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(finalResult).then(resolve);

  for (const method of ['select', 'eq', 'neq', 'is', 'not', 'or', 'in', 'gte', 'gt', 'lte', 'lt', 'order', 'limit']) {
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

describe('fetchMeetingsHeldRanking — mesma janela do KPI', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('usa a mesma janela de realizadas do KPI (fallback no carimbo + teto em agora)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T15:00:00.000Z'));
    const leadsChain = createChainMock({ data: [] });
    const supabase = createMockSupabase((table) => {
      if (table === 'leads') return leadsChain;
      return createChainMock({ data: [] });
    });

    await fetchMeetingsHeldRanking(supabase as never, ORG, baseFilters);

    expect(leadsChain.not).toHaveBeenCalledWith('meeting_held_at', 'is', null);
    expect(leadsChain.or).toHaveBeenCalledWith(
      meetingsHeldWindowFilter(
        '2026-01-01T03:00:00Z',
        '2026-01-31T23:59:59-03:00',
        '2026-01-10T15:00:00.000Z',
      ),
    );
  });
});

describe('fetchLeadsOpenedRanking — idealToDate por meta individual de leads', () => {
  it('uses each SDR individual leads_opened_target for per-SDR idealToDate (fallback to shared)', async () => {
    // Mês passado (2026-01) → pace cheio, ideal = meta.
    // u1 tem meta individual de leads (16) → ideal próprio = 16.
    // u2 tem meta individual = 0 → cai no ideal compartilhado (100 / 3 ≈ 33).
    const sdrsChain = createChainMock({
      data: [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' }],
    });
    const goalsChain = createChainMock({ data: { leads_opened_target: 100 } });
    // Mesmo chain serve countSdrsForIdeal (opportunity_target) e
    // fetchIndividualTargets (leads_opened_target) — inclui ambos os campos.
    const goalsPerUserChain = createChainMock({
      data: [
        { user_id: 'u1', opportunity_target: 10, leads_opened_target: 16 },
        { user_id: 'u2', opportunity_target: 10, leads_opened_target: 0 },
        { user_id: 'u3', opportunity_target: 10, leads_opened_target: 30 },
      ],
    });

    const supabase = createMockSupabase(
      (table) => {
        if (table === 'organization_members') return sdrsChain;
        if (table === 'goals') return goalsChain;
        if (table === 'goals_per_user') return goalsPerUserChain;
        return createChainMock();
      },
      (fn) =>
        // count por SDR (u1=2, u2=1); daily não importa pro idealToDate.
        fn === 'count_leads_opened_by_sdr'
          ? Promise.resolve({ data: [
              { performer_id: 'u1', cnt: 2 },
              { performer_id: 'u2', cnt: 1 },
            ] })
          : Promise.resolve({ data: [] }),
    );

    const result = await fetchLeadsOpenedRanking(supabase as never, ORG, baseFilters);

    expect(result.total).toBe(3);
    expect(result.monthTarget).toBe(100);
    const u1 = result.sdrBreakdown.find((s) => s.userId === 'u1');
    const u2 = result.sdrBreakdown.find((s) => s.userId === 'u2');
    // u1: meta individual 16 (mês cheio) → ideal próprio 16.
    expect(u1?.idealToDate).toBe(16);
    // u2: sem meta individual → fallback compartilhado = 100 / 3 SDRs ≈ 33.
    expect(u2?.idealToDate).toBe(33);
    // u3 tem meta (30) mas 0 leads abertos → não aparece no breakdown.
    expect(result.sdrBreakdown.find((s) => s.userId === 'u3')).toBeUndefined();
  });
});

describe('fetchSaoRanking', () => {
  it('conta só realizadas com SAO=true, atribuídas a SDR ativo, e lê a meta sao_target', async () => {
    const sdrsChain = createChainMock({ data: [{ user_id: 'u1' }, { user_id: 'u2' }] });
    const leadsChain = createChainMock({
      data: [
        { id: 'l1', assigned_to: 'u1' },
        { id: 'l2', assigned_to: 'u1' },
        { id: 'l3', assigned_to: 'u2' },
        { id: 'l4', assigned_to: 'manager-x' }, // não é SDR
        { id: 'l5', assigned_to: null },
      ],
    });
    const feedbackChain = createChainMock({
      data: [
        { lead_id: 'l1', oportunidade_qualificada: true, responded_at: '2026-01-10T10:00:00Z' },
        { lead_id: 'l2', oportunidade_qualificada: false, responded_at: '2026-01-10T10:00:00Z' },
        { lead_id: 'l3', oportunidade_qualificada: true, responded_at: '2026-01-10T10:00:00Z' },
        { lead_id: 'l4', oportunidade_qualificada: true, responded_at: '2026-01-10T10:00:00Z' },
      ],
    });
    const goalsChain = createChainMock({ data: { sao_target: 50 } });
    const goalsPerUserChain = createChainMock({ data: [] });

    const supabase = createMockSupabase((table) => {
      if (table === 'organization_members') return sdrsChain;
      if (table === 'leads') return leadsChain;
      if (table === 'closer_feedback_requests') return feedbackChain;
      if (table === 'goals') return goalsChain;
      if (table === 'goals_per_user') return goalsPerUserChain;
      return createChainMock();
    });

    const result = await fetchSaoRanking(supabase as never, ORG, baseFilters);

    expect(result.total).toBe(2);
    expect(result.monthTarget).toBe(50);
    expect(result.sdrBreakdown.find((s) => s.userId === 'u1')?.value).toBe(1);
    expect(result.sdrBreakdown.find((s) => s.userId === 'u2')?.value).toBe(1);
    // só leads de SDR entram na consulta de feedback
    expect(feedbackChain.in).toHaveBeenCalledWith('lead_id', ['l1', 'l2', 'l3']);
    expect(goalsPerUserChain.select).toHaveBeenCalledWith('user_id, sao_target');
  });

  it('respeita o filtro de vendedor', async () => {
    const sdrsChain = createChainMock({ data: [{ user_id: 'u1' }, { user_id: 'u2' }] });
    const leadsChain = createChainMock({
      data: [
        { id: 'l1', assigned_to: 'u1' },
        { id: 'l3', assigned_to: 'u2' },
      ],
    });
    const feedbackChain = createChainMock({
      data: [
        { lead_id: 'l1', oportunidade_qualificada: true, responded_at: '2026-01-10T10:00:00Z' },
        { lead_id: 'l3', oportunidade_qualificada: true, responded_at: '2026-01-10T10:00:00Z' },
      ],
    });
    const supabase = createMockSupabase((table) => {
      if (table === 'organization_members') return sdrsChain;
      if (table === 'leads') return leadsChain;
      if (table === 'closer_feedback_requests') return feedbackChain;
      return createChainMock({ data: null });
    });

    const result = await fetchSaoRanking(supabase as never, ORG, { ...baseFilters, userIds: ['u2'] });

    expect(result.total).toBe(1);
    expect(result.sdrBreakdown).toHaveLength(1);
    expect(result.sdrBreakdown[0]?.userId).toBe('u2');
  });

  it('usa a meta individual sao_target no ideal, com fallback compartilhado', async () => {
    // Mês passado (2026-01) → ritmo cheio: ideal individual = meta individual.
    const sdrsChain = createChainMock({ data: [{ user_id: 'u1' }, { user_id: 'u2' }] });
    const leadsChain = createChainMock({ data: [{ id: 'l1', assigned_to: 'u1' }, { id: 'l2', assigned_to: 'u2' }] });
    const feedbackChain = createChainMock({
      data: [
        { lead_id: 'l1', oportunidade_qualificada: true, responded_at: '2026-01-10T10:00:00Z' },
        { lead_id: 'l2', oportunidade_qualificada: true, responded_at: '2026-01-10T10:00:00Z' },
      ],
    });
    const goalsChain = createChainMock({ data: { sao_target: 20 } });
    // Mesmo chain serve countSdrsForIdeal (opportunity_target) e fetchIndividualTargets (sao_target)
    const goalsPerUserChain = createChainMock({
      data: [
        { user_id: 'u1', opportunity_target: 10, sao_target: 12 },
        { user_id: 'u2', opportunity_target: 10, sao_target: 0 },
      ],
    });
    const supabase = createMockSupabase((table) => {
      if (table === 'organization_members') return sdrsChain;
      if (table === 'leads') return leadsChain;
      if (table === 'closer_feedback_requests') return feedbackChain;
      if (table === 'goals') return goalsChain;
      if (table === 'goals_per_user') return goalsPerUserChain;
      return createChainMock();
    });

    const result = await fetchSaoRanking(supabase as never, ORG, baseFilters);

    const u1 = result.sdrBreakdown.find((s) => s.userId === 'u1');
    const u2 = result.sdrBreakdown.find((s) => s.userId === 'u2');
    expect(u1?.idealToDate).toBe(12); // meta individual
    expect(u2?.idealToDate).toBe(10); // cai no compartilhado (20 ÷ 2 = 10)
    expect(result.idealToDate).toBe(10);
  });

  it('reaproveita o universo de realizadas quando fornecido (leads consultada 1 vez para held + SAO)', async () => {
    const sdrsChain = createChainMock({ data: [{ user_id: 'u1' }] });
    const leadsChain = createChainMock({ data: [{ id: 'l1', assigned_to: 'u1' }, { id: 'l2', assigned_to: 'u1' }] });
    const feedbackChain = createChainMock({
      data: [{ lead_id: 'l1', oportunidade_qualificada: true, responded_at: '2026-01-10T10:00:00Z' }],
    });
    const supabase = createMockSupabase((table) => {
      if (table === 'organization_members') return sdrsChain;
      if (table === 'leads') return leadsChain;
      if (table === 'closer_feedback_requests') return feedbackChain;
      return createChainMock({ data: null });
    });

    const held = fetchHeldLeadsForRanking(supabase as never, ORG, baseFilters);
    const [heldCard, saoCard] = await Promise.all([
      fetchMeetingsHeldRanking(supabase as never, ORG, baseFilters, held),
      fetchSaoRanking(supabase as never, ORG, baseFilters, held),
    ]);

    expect(heldCard.total).toBe(2);
    expect(saoCard.total).toBe(1);
    const fromMock = (supabase as { from: ReturnType<typeof vi.fn> }).from;
    expect(fromMock.mock.calls.filter((c) => c[0] === 'leads')).toHaveLength(1);
  });
});

describe('fetchSaoRateRanking', () => {
  const card = (
    total: number,
    monthTarget: number,
    sdrBreakdown: RankingCardData['sdrBreakdown'],
  ): RankingCardData => ({ total, monthTarget, percentOfTarget: 0, averagePerSdr: 0, sdrBreakdown });

  it('0% sem reuniões', () => {
    const result = fetchSaoRateRanking(card(0, 0, []), card(0, 0, []));
    expect(result.total).toBe(0);
    expect(result.monthTarget).toBe(0);
    expect(result.sdrBreakdown).toHaveLength(0);
  });

  it('taxa por SDR = SAO ÷ realizadas; meta derivada = sao_target ÷ meetings_held_target', () => {
    // Realizadas: u1=4, u2=2. SAO: u1=2, u2=0 (u2 nem aparece no card de SAO).
    const held = card(6, 10, [
      { userId: 'u1', userName: '', value: 4 },
      { userId: 'u2', userName: '', value: 2 },
    ]);
    const sao = card(2, 5, [{ userId: 'u1', userName: '', value: 2 }]);

    const result = fetchSaoRateRanking(held, sao);

    expect(result.total).toBe(33); // 2/6
    expect(result.monthTarget).toBe(50); // 5/10
    expect(result.sdrBreakdown).toHaveLength(2);
    const u1 = result.sdrBreakdown.find((s) => s.userId === 'u1');
    expect(u1?.value).toBe(50);
    expect(u1?.secondaryValue).toBe(2);
    const u2 = result.sdrBreakdown.find((s) => s.userId === 'u2');
    expect(u2?.value).toBe(0);
    expect(u2?.secondaryValue).toBe(0);
    expect(result.sdrBreakdown[0]?.userId).toBe('u1'); // ordenado desc
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
    expect(result).toHaveProperty('sao');
    expect(result).toHaveProperty('saoRate');
    expect(result.leadsFinished.total).toBe(0);
    expect(result.sao.total).toBe(0);
    expect(result.saoRate.total).toBe(0);
    // Realizadas buscadas UMA vez para os cards "Reuniões Realizadas" e "SAO"
    const fromMock = (supabase as { from: ReturnType<typeof vi.fn> }).from;
    const leadsCalls = fromMock.mock.calls.filter((c) => c[0] === 'leads').length;
    // meetingsScheduled + held (compartilhado por Realizadas e SAO) = 2; sem o
    // compartilhamento seriam 3. (leadsFinished não consulta leads sem enrollments.)
    expect(leadsCalls).toBe(2);
  });
});

describe('fetchLeadsToOpenRanking — mesma fonte do filtro "Sem cadência" de /leads', () => {
  // Chain que responde { count } conforme o SDR passado em .eq('assigned_to', X).
  function createCountChain(countBySdr: Record<string, number>) {
    let sdr = '';
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, val: string) => {
      if (col === 'assigned_to') sdr = val;
      return chain;
    });
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ count: countBySdr[sdr] ?? 0, error: null }).then(resolve);
    return chain;
  }

  function setup(countBySdr: Record<string, number>) {
    const sdrsChain = createChainMock({ data: [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' }] });
    const tables: string[] = [];
    const countChains: Array<Record<string, unknown>> = [];
    const supabase = createMockSupabase((table) => {
      tables.push(table);
      if (table === 'organization_members') return sdrsChain;
      const c = createCountChain(countBySdr);
      countChains.push(c);
      return c;
    });
    return { supabase, tables, countChains };
  }

  it('conta por SDR na view leads_no_active_enrollment (status new, não deletado)', async () => {
    const { supabase, tables, countChains } = setup({ u1: 350, u2: 12, u3: 0 });

    const result = await fetchLeadsToOpenRanking(supabase as never, ORG, baseFilters);

    expect(tables.filter((t) => t !== 'organization_members')).toEqual([
      'leads_no_active_enrollment',
      'leads_no_active_enrollment',
      'leads_no_active_enrollment',
    ]);
    const first = countChains[0]!;
    expect(first.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(first.eq).toHaveBeenCalledWith('org_id', ORG);
    expect(first.eq).toHaveBeenCalledWith('status', 'new');
    expect(first.is).toHaveBeenCalledWith('deleted_at', null);

    expect(result.total).toBe(362);
    // SDR com fila zerada não aparece na lista.
    expect(result.sdrBreakdown.map((e) => [e.userId, e.value])).toEqual([
      ['u1', 350],
      ['u2', 12],
    ]);
    expect(result.averagePerSdr).toBe(181);
    expect(result.monthTarget).toBe(0);
  });

  it('respeita o filtro de SDR do dashboard', async () => {
    const { supabase, countChains } = setup({ u1: 350, u2: 12, u3: 5 });

    const result = await fetchLeadsToOpenRanking(supabase as never, ORG, { ...baseFilters, userIds: ['u2'] });

    expect(countChains).toHaveLength(1);
    expect(result.total).toBe(12);
    expect(result.sdrBreakdown).toEqual([{ userId: 'u2', userName: '', value: 12 }]);
  });
});
