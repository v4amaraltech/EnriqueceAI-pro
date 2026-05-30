import { describe, expect, it } from 'vitest';

import type { CallStatus } from '@/features/calls/types';

// Test the pure calculation logic by importing the module and testing via the exported function
// We test by calling fetchCallDashboardData with a mock supabase client

import { fetchCallDashboardData } from './call-dashboard.service';

function createMockSupabase(calls: Record<string, unknown>[], members: Record<string, unknown>[]) {
  const callsChain = {
    select: () => callsChain,
    eq: () => callsChain,
    gte: () => callsChain,
    lte: () => callsChain,
    in: () => callsChain,
    order: () => callsChain,
    limit: () => callsChain,
    then: (resolve: (v: { data: unknown[] }) => void) => resolve({ data: calls }),
  };

  const membersChain = {
    select: () => membersChain,
    eq: () => membersChain,
    then: (resolve: (v: { data: unknown[] }) => void) => resolve({ data: members }),
  };

  return {
    from: (table: string) => {
      if (table === 'calls') return callsChain;
      if (table === 'organization_members') return membersChain;
      return callsChain;
    },
  } as never;
}

describe('call-dashboard.service', () => {
  it('returns empty kpis when no calls', async () => {
    const supabase = createMockSupabase([], []);
    const result = await fetchCallDashboardData(
      supabase,
      'org-1',
      '2024-01-01T00:00:00Z',
      '2024-12-31T23:59:59Z',
    );

    expect(result.kpis.totalCalls).toBe(0);
    expect(result.kpis.avgDurationSeconds).toBe(0);
    expect(result.kpis.connectionRate).toBe(0);
    expect(result.kpis.significantRate).toBe(0);
    expect(result.outcomes).toHaveLength(0);
    expect(result.recentCalls).toHaveLength(0);
  });

  it('calculates kpis correctly with calls data', async () => {
    const calls = [
      { id: '1', user_id: 'u1', destination: '1234', status: 'significant' as CallStatus, duration_seconds: 120, started_at: '2024-06-15T10:00:00Z' },
      { id: '2', user_id: 'u1', destination: '5678', status: 'not_connected' as CallStatus, duration_seconds: 0, started_at: '2024-06-15T11:00:00Z' },
      { id: '3', user_id: 'u2', destination: '9012', status: 'not_significant' as CallStatus, duration_seconds: 60, started_at: '2024-06-15T14:00:00Z' },
    ];
    const members = [
      { user_id: 'u1', user_email: 'alice@test.com' },
      { user_id: 'u2', user_email: 'bob@test.com' },
    ];

    const supabase = createMockSupabase(calls, members);
    const result = await fetchCallDashboardData(
      supabase,
      'org-1',
      '2024-06-01T00:00:00Z',
      '2024-06-30T23:59:59Z',
    );

    expect(result.kpis.totalCalls).toBe(3);
    expect(result.kpis.avgDurationSeconds).toBe(60); // (120+0+60)/3
    expect(result.kpis.connectionRate).toBe(66.7); // 2/3 connected
    expect(result.kpis.significantRate).toBe(66.7); // 2/3 — significant == connected (duration >= 50s)
  });

  it('calculates outcomes distribution', async () => {
    const calls = [
      { id: '1', user_id: 'u1', destination: '1234', status: 'significant', duration_seconds: 100, started_at: '2024-06-15T10:00:00Z' },
      { id: '2', user_id: 'u1', destination: '5678', status: 'significant', duration_seconds: 200, started_at: '2024-06-15T11:00:00Z' },
      { id: '3', user_id: 'u1', destination: '9012', status: 'no_contact', duration_seconds: 0, started_at: '2024-06-15T14:00:00Z' },
    ];

    const supabase = createMockSupabase(calls, [{ user_id: 'u1', user_email: 'alice@test.com' }]);
    const result = await fetchCallDashboardData(
      supabase,
      'org-1',
      '2024-06-01T00:00:00Z',
      '2024-06-30T23:59:59Z',
    );

    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.find((o) => o.status === 'significant')?.count).toBe(2);
    expect(result.outcomes.find((o) => o.status === 'no_contact')?.count).toBe(1);
  });

  it('returns hourly distribution for business hours (8h–20h)', async () => {
    const supabase = createMockSupabase([], []);
    const result = await fetchCallDashboardData(
      supabase,
      'org-1',
      '2024-01-01T00:00:00Z',
      '2024-12-31T23:59:59Z',
    );

    expect(result.hourlyDistribution).toHaveLength(13);
    expect(result.hourlyDistribution[0]?.label).toBe('08h');
    expect(result.hourlyDistribution[12]?.label).toBe('20h');
  });

  it('limits recent calls to 10', async () => {
    const calls = Array.from({ length: 15 }, (_, i) => ({
      id: `call-${i}`,
      user_id: 'u1',
      destination: `555${i}`,
      status: 'significant',
      duration_seconds: 60,
      started_at: `2024-06-15T${(10 + i).toString().padStart(2, '0')}:00:00Z`,
    }));

    const supabase = createMockSupabase(calls, [{ user_id: 'u1', user_email: 'a@t.com' }]);
    const result = await fetchCallDashboardData(
      supabase,
      'org-1',
      '2024-06-01T00:00:00Z',
      '2024-06-30T23:59:59Z',
    );

    expect(result.recentCalls).toHaveLength(10);
  });
});
