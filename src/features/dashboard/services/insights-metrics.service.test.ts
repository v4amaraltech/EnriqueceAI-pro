import { describe, expect, it, vi } from 'vitest';

import {
  fetchConversionByOrigin,
  fetchInsightsData,
  fetchLossReasons,
} from './insights-metrics.service';

// --- Chainable + thenable mock builder ---
function createChainMock(finalResult: unknown = { data: null }) {
  const chain: Record<string, unknown> = {};

  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(finalResult).then(resolve);

  for (const method of ['select', 'eq', 'is', 'in', 'not', 'gte', 'lt', 'order', 'filter']) {
    chain[method] = vi.fn(() => chain);
  }

  return chain;
}

function createMockSupabase(fromImpl: (table: string) => Record<string, unknown>) {
  return { from: vi.fn(fromImpl) } as unknown;
}

const ORG = 'org-1';
const baseFilters = { month: '2026-01', cadenceIds: [] as string[], userIds: [] as string[] };

describe('fetchLossReasons', () => {
  it('should return empty array when no lead_lost interactions', async () => {
    const supabase = createMockSupabase(() => createChainMock({ data: [] }));

    const result = await fetchLossReasons(supabase as never, ORG, baseFilters);

    expect(result).toEqual([]);
  });

  it('should group and count by loss reason (from interaction metadata)', async () => {
    const interactionsChain = createChainMock({
      data: [
        { metadata: { system_event: 'lead_lost', loss_reason_id: 'lr-1' } },
        { metadata: { system_event: 'lead_lost', loss_reason_id: 'lr-1' } },
        { metadata: { system_event: 'lead_lost', loss_reason_id: 'lr-2' } },
      ],
    });
    const reasonsChain = createChainMock({
      data: [
        { id: 'lr-1', name: 'Sem orçamento' },
        { id: 'lr-2', name: 'Sem interesse' },
      ],
    });

    const supabase = createMockSupabase((table) => {
      if (table === 'interactions') return interactionsChain;
      if (table === 'loss_reasons') return reasonsChain;
      return createChainMock();
    });

    const result = await fetchLossReasons(supabase as never, ORG, baseFilters);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ reason: 'Sem orçamento', count: 2, percent: 67 });
    expect(result[1]).toEqual({ reason: 'Sem interesse', count: 1, percent: 33 });
  });

  it('should exclude auto-loss-by-inactivity interactions', async () => {
    const interactionsChain = createChainMock({
      data: [
        { metadata: { system_event: 'lead_lost', loss_reason_id: 'lr-1' } },
        { metadata: { system_event: 'lead_lost', loss_reason_id: 'lr-auto', reason: 'auto_loss_inactivity' } },
      ],
    });
    const reasonsChain = createChainMock({ data: [{ id: 'lr-1', name: 'Sem interesse' }] });

    const supabase = createMockSupabase((table) => {
      if (table === 'interactions') return interactionsChain;
      if (table === 'loss_reasons') return reasonsChain;
      return createChainMock();
    });

    const result = await fetchLossReasons(supabase as never, ORG, baseFilters);

    expect(result).toEqual([{ reason: 'Sem interesse', count: 1, percent: 100 }]);
  });

  it('should sort by count descending', async () => {
    const interactionsChain = createChainMock({
      data: [
        { metadata: { loss_reason_id: 'lr-a' } },
        { metadata: { loss_reason_id: 'lr-b' } },
        { metadata: { loss_reason_id: 'lr-b' } },
        { metadata: { loss_reason_id: 'lr-b' } },
      ],
    });
    const reasonsChain = createChainMock({
      data: [
        { id: 'lr-a', name: 'Reason A' },
        { id: 'lr-b', name: 'Reason B' },
      ],
    });

    const supabase = createMockSupabase((table) => {
      if (table === 'interactions') return interactionsChain;
      if (table === 'loss_reasons') return reasonsChain;
      return createChainMock();
    });

    const result = await fetchLossReasons(supabase as never, ORG, baseFilters);

    expect(result[0]?.reason).toBe('Reason B');
    expect(result[0]?.count).toBe(3);
  });

  it('should use "Desconhecido" for unknown reason ids', async () => {
    const interactionsChain = createChainMock({
      data: [{ metadata: { loss_reason_id: 'lr-unknown' } }],
    });
    const reasonsChain = createChainMock({ data: [] });

    const supabase = createMockSupabase((table) => {
      if (table === 'interactions') return interactionsChain;
      if (table === 'loss_reasons') return reasonsChain;
      return createChainMock();
    });

    const result = await fetchLossReasons(supabase as never, ORG, baseFilters);

    expect(result[0]?.reason).toBe('Desconhecido');
  });
});

describe('fetchConversionByOrigin', () => {
  it('should return empty array when no enrollments', async () => {
    const enrollmentChain = createChainMock({ data: [] });

    const supabase = createMockSupabase(() => enrollmentChain);

    const result = await fetchConversionByOrigin(supabase as never, ORG, baseFilters);

    expect(result).toEqual([]);
  });

  it('should group by lead_source and count qualified vs lost', async () => {
    // The function fires two separate leads queries: wonQuery (status='won')
    // then lostQuery (status='unqualified'). Model them distinctly — returning
    // the same rows for both would double-count.
    const wonChain = createChainMock({
      data: [
        { id: 'l1', status: 'won', lead_source: 'outbound', canal: null },
        { id: 'l3', status: 'won', lead_source: 'indicacao', canal: null },
      ],
    });
    const lostChain = createChainMock({
      data: [{ id: 'l2', status: 'unqualified', lead_source: 'outbound', canal: null }],
    });
    let leadsCall = 0;

    const supabase = createMockSupabase((table) => {
      if (table === 'leads') {
        leadsCall += 1;
        return leadsCall === 1 ? wonChain : lostChain;
      }
      return createChainMock();
    });

    const result = await fetchConversionByOrigin(supabase as never, ORG, baseFilters);

    expect(result).toHaveLength(2);

    const outbound = result.find((e) => e.origin === 'Outbound');
    expect(outbound?.converted).toBe(1);
    expect(outbound?.lost).toBe(1);

    const indicacao = result.find((e) => e.origin === 'Indicação');
    expect(indicacao?.converted).toBe(1);
    expect(indicacao?.lost).toBe(0);
  });

  it('should skip leads with non-terminal status (new, contacted)', async () => {
    const enrollmentChain = createChainMock({
      data: [
        { lead_id: 'l1', cadence_id: 'c1' },
        { lead_id: 'l2', cadence_id: 'c1' },
      ],
    });
    const leadsChain = createChainMock({
      data: [
        { id: 'l1', status: 'new', lead_source: 'outbound' },
        { id: 'l2', status: 'contacted', lead_source: 'indicacao' },
      ],
    });

    const supabase = createMockSupabase((table) => {
      if (table === 'cadence_enrollments') return enrollmentChain;
      if (table === 'leads') return leadsChain;
      return createChainMock();
    });

    const result = await fetchConversionByOrigin(supabase as never, ORG, baseFilters);

    expect(result).toHaveLength(0);
  });

  it('should sort by total (converted + lost) descending', async () => {
    const enrollmentChain = createChainMock({
      data: [
        { lead_id: 'l1', cadence_id: 'c1' },
        { lead_id: 'l2', cadence_id: 'c2' },
        { lead_id: 'l3', cadence_id: 'c2' },
        { lead_id: 'l4', cadence_id: 'c2' },
      ],
    });
    const leadsChain = createChainMock({
      data: [
        { id: 'l1', status: 'qualified', lead_source: 'indicacao' },
        { id: 'l2', status: 'qualified', lead_source: 'outbound' },
        { id: 'l3', status: 'unqualified', lead_source: 'outbound' },
        { id: 'l4', status: 'archived', lead_source: 'outbound' },
      ],
    });

    const supabase = createMockSupabase((table) => {
      if (table === 'cadence_enrollments') return enrollmentChain;
      if (table === 'leads') return leadsChain;
      return createChainMock();
    });

    const result = await fetchConversionByOrigin(supabase as never, ORG, baseFilters);

    expect(result[0]?.origin).toBe('Outbound'); // 3 total
    expect(result[1]?.origin).toBe('Indicação'); // 1 total
  });

  it('should fallback to "unknown" for leads without lead_source', async () => {
    const enrollmentChain = createChainMock({
      data: [{ lead_id: 'l1', cadence_id: 'c1' }],
    });
    const leadsChain = createChainMock({
      data: [{ id: 'l1', status: 'qualified', lead_source: null }],
    });

    const supabase = createMockSupabase((table) => {
      if (table === 'cadence_enrollments') return enrollmentChain;
      if (table === 'leads') return leadsChain;
      return createChainMock();
    });

    const result = await fetchConversionByOrigin(supabase as never, ORG, baseFilters);

    expect(result[0]?.origin).toBe('unknown');
  });

  it('should exclude leads auto-lost by inactivity from the lost count', async () => {
    // The lostQuery returns two unqualified outbound leads; l2 carries an
    // auto_loss_inactivity interaction, so only l3 should count as lost.
    const wonChain = createChainMock({ data: [] });
    const lostChain = createChainMock({
      data: [
        { id: 'l2', status: 'unqualified', lead_source: 'outbound', canal: null },
        { id: 'l3', status: 'unqualified', lead_source: 'outbound', canal: null },
      ],
    });
    let leadsCall = 0;
    const interactionsChain = createChainMock({ data: [{ lead_id: 'l2' }] });

    const supabase = createMockSupabase((table) => {
      if (table === 'leads') {
        // First leads query is wonQuery, second is lostQuery.
        leadsCall += 1;
        return leadsCall === 1 ? wonChain : lostChain;
      }
      if (table === 'interactions') return interactionsChain;
      return createChainMock();
    });

    const result = await fetchConversionByOrigin(supabase as never, ORG, baseFilters);

    const outbound = result.find((e) => e.origin === 'Outbound');
    expect(outbound?.lost).toBe(1); // l3 only — l2 excluded as auto-loss
  });
});

describe('fetchInsightsData', () => {
  it('should return both lossReasons and conversionByOrigin', async () => {
    const emptyChain = createChainMock({ data: [] });

    const supabase = createMockSupabase(() => emptyChain);

    const result = await fetchInsightsData(supabase as never, ORG, baseFilters);

    expect(result).toHaveProperty('lossReasons');
    expect(result).toHaveProperty('conversionByOrigin');
    expect(result.lossReasons).toEqual([]);
    expect(result.conversionByOrigin).toEqual([]);
  });
});
