import { describe, expect, it, vi } from 'vitest';

import { fetchExtratoData } from './extrato.service';

vi.mock('@/features/statistics/services/member-lookup', () => ({
  buildMemberNameMap: vi.fn().mockResolvedValue(
    new Map([
      ['u1', 'alice'],
      ['u2', 'bob'],
    ]),
  ),
}));

function createMockSupabase(calls: Record<string, unknown>[], members: Record<string, unknown>[]) {
  const callsChain: Record<string, unknown> = {};
  callsChain.select = vi.fn().mockReturnValue(callsChain);
  callsChain.eq = vi.fn().mockReturnValue(callsChain);
  callsChain.gte = vi.fn().mockReturnValue(callsChain);
  callsChain.lte = vi.fn().mockReturnValue(callsChain);
  callsChain.in = vi.fn().mockReturnValue(callsChain);
  callsChain.order = vi.fn().mockResolvedValue({ data: calls });

  const membersChain: Record<string, unknown> = {};
  membersChain.select = vi.fn().mockReturnValue(membersChain);
  membersChain.eq = vi.fn().mockReturnValue(membersChain);

  // Last .eq() call resolves with data
  let memberEqCallCount = 0;
  (membersChain.eq as ReturnType<typeof vi.fn>).mockImplementation(() => {
    memberEqCallCount++;
    if (memberEqCallCount >= 2) {
      return Promise.resolve({ data: members });
    }
    return membersChain;
  });

  return {
    from: (table: string) => {
      if (table === 'calls') return callsChain;
      if (table === 'organization_members') return membersChain;
      return callsChain;
    },
  } as never;
}

describe('fetchExtratoData', () => {
  it('should return empty data when no calls', async () => {
    const supabase = createMockSupabase([], []);
    const result = await fetchExtratoData(supabase, 'org-1', '2026-01-01', '2026-01-31');

    expect(result.kpis.totalCalls).toBe(0);
    expect(result.kpis.totalDurationSeconds).toBe(0);
    expect(result.kpis.totalCost).toBe(0);
    expect(result.dailyBreakdown).toEqual([]);
    expect(result.sdrBreakdown).toEqual([]);
  });

  it('should calculate KPIs correctly', async () => {
    const calls = [
      { id: '1', user_id: 'u1', status: 'significant', duration_seconds: 120, cost: 0.50, started_at: '2026-01-15T10:00:00Z' },
      { id: '2', user_id: 'u1', status: 'not_connected', duration_seconds: 10, cost: 0.10, started_at: '2026-01-15T11:00:00Z' },
      { id: '3', user_id: 'u2', status: 'not_significant', duration_seconds: 60, cost: null, started_at: '2026-01-16T09:00:00Z' },
    ];
    const members = [
      { user_id: 'u1', user_email: 'alice@test.com' },
      { user_id: 'u2', user_email: 'bob@test.com' },
    ];

    const supabase = createMockSupabase(calls, members);
    const result = await fetchExtratoData(supabase, 'org-1', '2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z');

    expect(result.kpis.totalCalls).toBe(3);
    expect(result.kpis.totalDurationSeconds).toBe(190);
    expect(result.kpis.totalCost).toBeCloseTo(0.60);
  });

  it('should group daily breakdown by date', async () => {
    const calls = [
      { id: '1', user_id: 'u1', status: 'significant', duration_seconds: 60, cost: 0.20, started_at: '2026-01-15T10:00:00Z' },
      { id: '2', user_id: 'u1', status: 'not_connected', duration_seconds: 10, cost: 0.05, started_at: '2026-01-15T14:00:00Z' },
      { id: '3', user_id: 'u2', status: 'significant', duration_seconds: 90, cost: 0.30, started_at: '2026-01-16T09:00:00Z' },
    ];

    const supabase = createMockSupabase(calls, [{ user_id: 'u1', user_email: 'a@t.com' }]);
    const result = await fetchExtratoData(supabase, 'org-1', '2026-01-01', '2026-01-31');

    expect(result.dailyBreakdown).toHaveLength(2);
    // Sorted descending
    expect(result.dailyBreakdown[0]?.date).toBe('2026-01-16');
    expect(result.dailyBreakdown[1]?.date).toBe('2026-01-15');
    expect(result.dailyBreakdown[1]?.calls).toBe(2);
    expect(result.dailyBreakdown[1]?.significantCalls).toBe(1);
  });

  it('should group SDR breakdown by user', async () => {
    const calls = [
      { id: '1', user_id: 'u1', status: 'significant', duration_seconds: 120, cost: 0.50, started_at: '2026-01-15T10:00:00Z' },
      { id: '2', user_id: 'u1', status: 'not_significant', duration_seconds: 60, cost: 0.20, started_at: '2026-01-15T11:00:00Z' },
      { id: '3', user_id: 'u2', status: 'not_connected', duration_seconds: 10, cost: 0.05, started_at: '2026-01-16T09:00:00Z' },
    ];
    const members = [
      { user_id: 'u1', user_email: 'alice@test.com' },
      { user_id: 'u2', user_email: 'bob@test.com' },
    ];

    const supabase = createMockSupabase(calls, members);
    const result = await fetchExtratoData(supabase, 'org-1', '2026-01-01', '2026-01-31');

    expect(result.sdrBreakdown).toHaveLength(2);
    // u1 has more calls, should be first
    expect(result.sdrBreakdown[0]?.userName).toBe('alice');
    expect(result.sdrBreakdown[0]?.calls).toBe(2);
    expect(result.sdrBreakdown[0]?.connectionRate).toBe(100);
    expect(result.sdrBreakdown[1]?.userName).toBe('bob');
    expect(result.sdrBreakdown[1]?.connectionRate).toBe(0);
  });
});
