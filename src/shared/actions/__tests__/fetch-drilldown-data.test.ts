import { describe, expect, it, vi } from 'vitest';

import type { FetchDrilldownInput } from '@/shared/schemas/drilldown.schema';

vi.mock('@/lib/auth/get-org-id', () => ({
  getAuthOrgIdResult: vi.fn(),
}));

vi.mock('@/lib/supabase/from', () => ({
  from: vi.fn(),
}));

function createChainableMock(resolvedValue: { data: any; count: number | null }) {
  const chain: any = {};
  const methods = ['select', 'eq', 'in', 'gte', 'lte', 'order', 'range'];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  // The last call in the chain resolves
  chain.range = vi.fn(() => Promise.resolve(resolvedValue));
  chain.select = vi.fn(() => chain);
  return chain;
}

describe('fetchDrilldownData', () => {
  it('returns error for invalid input', async () => {
    const { fetchDrilldownData } = await import('../fetch-drilldown-data');
    const result = await fetchDrilldownData({} as any);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Parâmetros inválidos');
    }
  });

  it('returns data for overall_contacted metric', async () => {
    const { getAuthOrgIdResult } = await import('@/lib/auth/get-org-id');
    const { from } = await import('@/lib/supabase/from');

    const mockData = [
      {
        id: 'i1',
        type: 'sent',
        created_at: '2026-01-15T10:00:00Z',
        lead_id: 'l1',
        cadence_id: 'c1',
        leads: { id: 'l1', razao_social: 'Acme', nome_fantasia: 'Acme Co', email: 'a@a.com' },
        cadences: { id: 'c1', name: 'Outbound' },
      },
    ];

    const chain = createChainableMock({ data: mockData, count: 1 });
    vi.mocked(from).mockReturnValue(chain);
    vi.mocked(getAuthOrgIdResult).mockResolvedValue({
      success: true,
      data: { orgId: 'org-1', userId: 'u-1', supabase: {} as any },
    });

    const { fetchDrilldownData } = await import('../fetch-drilldown-data');
    const input: FetchDrilldownInput = {
      metric: 'overall_contacted',
      filters: { from: '2026-01-01', to: '2026-01-31' },
      page: 1,
    };

    const result = await fetchDrilldownData(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toHaveLength(1);
      expect(result.data.data[0]!.razaoSocial).toBe('Acme');
      expect(result.data.total).toBe(1);
      expect(result.data.page).toBe(1);
    }
  });

  it('returns data for conversion_stage metric', async () => {
    const { getAuthOrgIdResult } = await import('@/lib/auth/get-org-id');
    const { from } = await import('@/lib/supabase/from');

    const mockData = [
      { id: 'l1', razao_social: 'Beta Corp', nome_fantasia: 'Beta', email: 'b@b.com', status: 'qualified' },
    ];

    const chain = createChainableMock({ data: mockData, count: 1 });
    vi.mocked(from).mockReturnValue(chain);
    vi.mocked(getAuthOrgIdResult).mockResolvedValue({
      success: true,
      data: { orgId: 'org-1', userId: 'u-1', supabase: {} as any },
    });

    const { fetchDrilldownData } = await import('../fetch-drilldown-data');
    const input: FetchDrilldownInput = {
      metric: 'conversion_stage',
      filters: { from: '2026-01-01', to: '2026-01-31', stage: 'qualified' },
      page: 1,
    };

    const result = await fetchDrilldownData(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toHaveLength(1);
      expect(result.data.data[0]!.leadId).toBe('l1');
      expect(result.data.data[0]!.status).toBe('qualified');
    }
  });

  it('returns data for overall_leads metric', async () => {
    const { getAuthOrgIdResult } = await import('@/lib/auth/get-org-id');
    const { from } = await import('@/lib/supabase/from');

    // First two calls return lead_ids, third returns leads
    const interactionChain = createChainableMock({ data: [{ lead_id: 'l1' }], count: null });
    // Override range to just resolve directly for the select-only queries
    interactionChain.lte = vi.fn(() => Promise.resolve({ data: [{ lead_id: 'l1' }] }));

    const enrollmentChain = createChainableMock({ data: [{ lead_id: 'l2' }], count: null });
    enrollmentChain.lte = vi.fn(() => Promise.resolve({ data: [{ lead_id: 'l2' }] }));

    const leadsChain = createChainableMock({
      data: [
        { id: 'l1', razao_social: 'Acme', nome_fantasia: 'Acme', email: 'a@a.com', status: 'new' },
        { id: 'l2', razao_social: 'Beta', nome_fantasia: 'Beta', email: 'b@b.com', status: 'contacted' },
      ],
      count: 2,
    });

    let callCount = 0;
    vi.mocked(from).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return interactionChain;
      if (callCount === 2) return enrollmentChain;
      return leadsChain;
    });

    vi.mocked(getAuthOrgIdResult).mockResolvedValue({
      success: true,
      data: { orgId: 'org-1', userId: 'u-1', supabase: {} as any },
    });

    const { fetchDrilldownData } = await import('../fetch-drilldown-data');
    const input: FetchDrilldownInput = {
      metric: 'overall_leads',
      filters: { from: '2026-01-01', to: '2026-01-31' },
      page: 1,
    };

    const result = await fetchDrilldownData(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toHaveLength(2);
      expect(result.data.total).toBe(2);
    }
  });
});
