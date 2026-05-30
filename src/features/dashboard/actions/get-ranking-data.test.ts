import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, resetMocks } from '@tests/mocks/supabase';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

const mockRequireAuthWithMember = vi.fn();
vi.mock('@/lib/auth/require-auth-with-member', () => ({
  requireAuthWithMember: (...args: unknown[]) => mockRequireAuthWithMember(...args),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({ auth: { admin: { listUsers: vi.fn().mockResolvedValue({ data: { users: [] } }) } } }),
}));

const mockFetchRanking = vi.fn();

vi.mock('../services/ranking-metrics.service', () => ({
  fetchRankingData: (...args: unknown[]) => mockFetchRanking(...args),
}));

import { getRankingData } from './get-ranking-data';

const emptyCard = {
  total: 0,
  monthTarget: 0,
  percentOfTarget: 0,
  averagePerSdr: 0,
  sdrBreakdown: [],
};

describe('getRankingData', () => {
  beforeEach(() => {
    resetMocks();
    mockFetchRanking.mockReset();
    mockRequireAuthWithMember.mockResolvedValue({ userId: 'user-1', orgId: 'org-1', role: 'manager' });
  });

  const validFilters = {
    month: '2026-02',
    cadenceIds: [] as string[],
    userIds: [] as string[],
  };

  const fullRanking = (overrides: Record<string, unknown> = {}) => ({
    leadsFinished: { ...emptyCard },
    activitiesDone: { ...emptyCard },
    conversionRate: { ...emptyCard },
    leadsOpened: { ...emptyCard },
    meetingsScheduled: { ...emptyCard },
    meetingsHeld: { ...emptyCard },
    hitRate: { ...emptyCard },
    leadsToOpen: { ...emptyCard },
    overdueActivities: { ...emptyCard },
    ...overrides,
  });

  it('should return success with ranking data', async () => {
    const rankingData = fullRanking({
      leadsFinished: { ...emptyCard, total: 15 },
      activitiesDone: { ...emptyCard, total: 200 },
      conversionRate: { ...emptyCard, total: 42 },
    });
    mockFetchRanking.mockResolvedValue(rankingData);

    const result = await getRankingData(validFilters);

    expect(result).toEqual({ success: true, data: rankingData });
  });

  it('should return error for invalid filters', async () => {
    const result = await getRankingData({
      month: 'bad',
      cadenceIds: [],
      userIds: [],
    });

    expect(result).toEqual({ success: false, error: 'Filtros inválidos' });
  });

  it('should throw when org not found (redirect)', async () => {
    mockRequireAuthWithMember.mockRejectedValue(new Error('NEXT_REDIRECT'));

    await expect(getRankingData(validFilters)).rejects.toThrow('NEXT_REDIRECT');
  });

  it('should return error when service throws', async () => {
    mockFetchRanking.mockRejectedValue(new Error('fail'));

    const result = await getRankingData(validFilters);

    expect(result).toEqual({
      success: false,
      error: 'Erro ao buscar dados de ranking',
    });
  });

  it('should pass org_id and filters to service', async () => {
    mockRequireAuthWithMember.mockResolvedValue({ userId: 'user-1', orgId: 'org-42', role: 'manager' });

    mockFetchRanking.mockResolvedValue(fullRanking());

    await getRankingData(validFilters);

    expect(mockFetchRanking).toHaveBeenCalledWith(
      mockSupabase,
      'org-42',
      validFilters,
    );
  });
});
