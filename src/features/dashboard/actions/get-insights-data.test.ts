import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';

const mockFrom = mockSupabaseFrom as ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

const mockRequireAuthWithMember = vi.fn();
vi.mock('@/lib/auth/require-auth-with-member', () => ({
  requireAuthWithMember: (...args: unknown[]) => mockRequireAuthWithMember(...args),
}));

const mockFetchInsights = vi.fn();

vi.mock('../services/insights-metrics.service', () => ({
  fetchInsightsData: (...args: unknown[]) => mockFetchInsights(...args),
}));

import { getInsightsData } from './get-insights-data';

function createChainMock(finalResult: unknown = { data: null }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(() => Promise.resolve(finalResult)),
  };
}

describe('getInsightsData', () => {
  beforeEach(() => {
    resetMocks();
    mockFetchInsights.mockReset();
    mockRequireAuthWithMember.mockResolvedValue({ userId: 'user-1', orgId: 'org-1', role: 'manager' });
  });

  const validFilters = {
    month: '2026-02',
    cadenceIds: [] as string[],
    userIds: [] as string[],
  };

  it('should return success with insights data', async () => {
    const insightsData = {
      lossReasons: [{ reason: 'Sem orçamento', count: 5, percent: 100 }],
      conversionByOrigin: [{ origin: 'Inbound', converted: 3, lost: 1 }],
    };
    mockFetchInsights.mockResolvedValue(insightsData);

    const result = await getInsightsData(validFilters);

    expect(result).toEqual({ success: true, data: insightsData });
  });

  it('should return error for invalid filters', async () => {
    const result = await getInsightsData({
      month: 'invalid',
      cadenceIds: [],
      userIds: [],
    });

    expect(result).toEqual({ success: false, error: 'Filtros inválidos' });
  });

  it('should throw when org not found (redirect)', async () => {
    mockRequireAuthWithMember.mockRejectedValue(new Error('NEXT_REDIRECT'));

    await expect(getInsightsData(validFilters)).rejects.toThrow('NEXT_REDIRECT');
  });

  it('should return error when service throws', async () => {
    mockFetchInsights.mockRejectedValue(new Error('fail'));

    const result = await getInsightsData(validFilters);

    expect(result).toEqual({
      success: false,
      error: 'Erro ao buscar dados de insights',
    });
  });

  it('should pass org_id and filters to service', async () => {
    mockRequireAuthWithMember.mockResolvedValue({ userId: 'user-1', orgId: 'org-42', role: 'manager' });

    mockFetchInsights.mockResolvedValue({
      lossReasons: [],
      conversionByOrigin: [],
    });

    await getInsightsData(validFilters);

    expect(mockFetchInsights).toHaveBeenCalledWith(
      mockSupabase,
      'org-42',
      validFilters,
    );
  });
});
