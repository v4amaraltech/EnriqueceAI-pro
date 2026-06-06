import { describe, expect, it, vi } from 'vitest';

import type { StatisticsFilters } from './statistics.service';
import {
  fetchConversionByOrigin,
  fetchLossReasonStats,
  fetchResponseTimeData,
} from './statistics.service';

const filters: StatisticsFilters = {
  periodStart: '2026-01-01T00:00:00.000Z',
  periodEnd: '2026-02-21T23:59:59.000Z',
};

function createMockSupabase(overrides: Record<string, unknown> = {}) {
  const chainable = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null }),
    then: undefined as unknown,
    ...overrides,
  };

  // Make it thenable for await
  const defaultData = overrides.data ?? null;
  chainable.then = (resolve: (v: unknown) => void) =>
    resolve({ data: defaultData });

  return {
    from: vi.fn().mockReturnValue(chainable),
    _chainable: chainable,
  };
}

describe('fetchLossReasonStats', () => {
  it('returns empty array when no loss reasons exist', async () => {
    const supabase = createMockSupabase({ data: null });
    const result = await fetchLossReasonStats(supabase as never, 'org-1', filters);
    expect(result).toEqual([]);
  });

  it('returns empty array when no enrollments with loss reasons', async () => {
    let callCount = 0;
    const supabase = {
      from: vi.fn().mockImplementation(() => {
        callCount++;
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: undefined as unknown,
        };
        if (callCount === 1) {
          // loss_reasons
          chain.then = (resolve: (v: unknown) => void) =>
            resolve({ data: [{ id: 'lr-1', name: 'Sem budget' }] });
        } else {
          // enrollments
          chain.then = (resolve: (v: unknown) => void) =>
            resolve({ data: [] });
        }
        return chain;
      }),
    };

    const result = await fetchLossReasonStats(supabase as never, 'org-1', filters);
    expect(result).toEqual([]);
  });

  it('calculates percentages correctly', async () => {
    let callCount = 0;
    const supabase = {
      from: vi.fn().mockImplementation(() => {
        callCount++;
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: undefined as unknown,
        };
        if (callCount === 1) {
          chain.then = (resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { id: 'lr-1', name: 'Sem budget' },
                { id: 'lr-2', name: 'Concorrente' },
              ],
            });
        } else {
          // lead_lost interactions (authoritative loss-reason source)
          chain.then = (resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { metadata: { system_event: 'lead_lost', loss_reason_id: 'lr-1' } },
                { metadata: { system_event: 'lead_lost', loss_reason_id: 'lr-1' } },
                { metadata: { system_event: 'lead_lost', loss_reason_id: 'lr-1' } },
                { metadata: { system_event: 'lead_lost', loss_reason_id: 'lr-2' } },
              ],
            });
        }
        return chain;
      }),
    };

    const result = await fetchLossReasonStats(supabase as never, 'org-1', filters);
    expect(result).toHaveLength(2);
    expect(result[0]!.reasonName).toBe('Sem budget');
    expect(result[0]!.count).toBe(3);
    expect(result[0]!.percentage).toBe(75);
    expect(result[1]!.reasonName).toBe('Concorrente');
    expect(result[1]!.count).toBe(1);
    expect(result[1]!.percentage).toBe(25);
  });
});

describe('fetchConversionByOrigin', () => {
  it('returns empty array when no leads', async () => {
    const supabase = createMockSupabase({ data: [] });
    const result = await fetchConversionByOrigin(supabase as never, 'org-1', filters);
    expect(result).toEqual([]);
  });

  it('groups leads by creator and calculates conversion', async () => {
    const supabase = createMockSupabase({
      data: [
        { id: 'l1', status: 'qualified', created_by: 'u1' },
        { id: 'l2', status: 'unqualified', created_by: 'u1' },
        { id: 'l3', status: 'qualified', created_by: 'u1' },
        { id: 'l4', status: 'qualified', created_by: 'u2' },
        { id: 'l5', status: 'archived', created_by: 'u2' },
      ],
    });

    const result = await fetchConversionByOrigin(supabase as never, 'org-1', filters);
    expect(result).toHaveLength(2);

    const u1 = result.find((r) => r.origin === 'u1');
    expect(u1?.qualified).toBe(2);
    expect(u1?.unqualified).toBe(1);
    expect(u1?.conversionRate).toBe(67);

    const u2 = result.find((r) => r.origin === 'u2');
    expect(u2?.qualified).toBe(1);
    expect(u2?.unqualified).toBe(1);
    expect(u2?.conversionRate).toBe(50);
  });
});

describe('fetchResponseTimeData', () => {
  it('returns zero stats when no leads', async () => {
    const supabase = createMockSupabase({ data: [] });
    const result = await fetchResponseTimeData(supabase as never, 'org-1', filters);
    expect(result.overallPct).toBe(0);
    expect(result.totalLeads).toBe(0);
    expect(result.byCadence).toEqual([]);
  });

  it('returns zero stats when leads but no interactions', async () => {
    let callCount = 0;
    const supabase = {
      from: vi.fn().mockImplementation(() => {
        callCount++;
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: undefined as unknown,
        };
        if (callCount === 1) {
          chain.then = (resolve: (v: unknown) => void) =>
            resolve({ data: [{ id: 'l1', created_at: '2026-01-15T10:00:00Z' }] });
        } else {
          chain.then = (resolve: (v: unknown) => void) =>
            resolve({ data: [] });
        }
        return chain;
      }),
    };

    const result = await fetchResponseTimeData(supabase as never, 'org-1', filters);
    expect(result.totalLeads).toBe(1);
    expect(result.overallPct).toBe(0);
    expect(result.overallCount).toBe(0);
  });

  it('calculates response time within threshold', async () => {
    let callCount = 0;
    const supabase = {
      from: vi.fn().mockImplementation(() => {
        callCount++;
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: undefined as unknown,
        };
        if (callCount === 1) {
          // leads
          chain.then = (resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { id: 'l1', created_at: '2026-01-15T10:00:00Z' },
                { id: 'l2', created_at: '2026-01-15T10:00:00Z' },
              ],
            });
        } else if (callCount === 2) {
          // interactions (first interaction per lead)
          chain.then = (resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { lead_id: 'l1', cadence_id: 'c1', created_at: '2026-01-15T10:30:00Z' }, // 30 min — within 60
                { lead_id: 'l2', cadence_id: 'c1', created_at: '2026-01-15T12:30:00Z' }, // 150 min — outside 60
              ],
            });
        } else {
          // cadences
          chain.then = (resolve: (v: unknown) => void) =>
            resolve({ data: [{ id: 'c1', name: 'Cadência Teste' }] });
        }
        return chain;
      }),
    };

    const filtersWithThreshold = { ...filters, thresholdMinutes: 60 };
    const result = await fetchResponseTimeData(supabase as never, 'org-1', filtersWithThreshold);

    expect(result.thresholdMinutes).toBe(60);
    expect(result.totalLeads).toBe(2);
    expect(result.overallCount).toBe(1);
    expect(result.overallPct).toBe(50);
    expect(result.byCadence).toHaveLength(1);
    expect(result.byCadence[0]!.cadenceName).toBe('Cadência Teste');
    expect(result.byCadence[0]!.withinThresholdPct).toBe(50);
  });
});
