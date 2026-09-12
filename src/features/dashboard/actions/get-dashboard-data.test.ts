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

// Mock service functions
const mockFetchKpi = vi.fn();
const mockFetchSaoKpi = vi.fn();
const mockFetchHeld = vi.fn();
const mockFetchCadences = vi.fn();

vi.mock('../services/dashboard-metrics.service', () => ({
  fetchHeldLeadsForKpi: (...args: unknown[]) => mockFetchHeld(...args),
  fetchOpportunityKpi: (...args: unknown[]) => mockFetchKpi(...args),
  fetchSaoKpi: (...args: unknown[]) => mockFetchSaoKpi(...args),
  fetchAvailableCadences: (...args: unknown[]) => mockFetchCadences(...args),
}));

import { getDashboardData } from './get-dashboard-data';

describe('getDashboardData', () => {
  beforeEach(() => {
    resetMocks();
    mockFetchKpi.mockReset();
    mockFetchSaoKpi.mockReset();
    mockFetchHeld.mockReset();
    mockFetchHeld.mockResolvedValue([]);
    mockFetchCadences.mockReset();
    mockRequireAuthWithMember.mockResolvedValue({ userId: 'user-1', orgId: 'org-1', role: 'manager' });
  });

  const validFilters = {
    month: '2026-02',
    cadenceIds: [] as string[],
    userIds: [] as string[],
  };

  it('should return success with dashboard data', async () => {
    const kpiData = {
      totalOpportunities: 10,
      monthTarget: 50,
      conversionTarget: 5,
      percentOfTarget: -30,
      currentDay: 15,
      daysInMonth: 28,
      dailyData: [],
    };
    const saoKpiData = { ...kpiData, totalOpportunities: 3, monthTarget: 20, heldTotal: 10, evaluatedTotal: 4, qualifiedTotal: 3 };
    const cadences = [{ id: 'c1', name: 'Inbound' }];

    mockFetchKpi.mockResolvedValue(kpiData);
    mockFetchSaoKpi.mockResolvedValue(saoKpiData);
    mockFetchCadences.mockResolvedValue(cadences);

    const result = await getDashboardData(validFilters);

    expect(result).toEqual({
      success: true,
      data: { kpi: kpiData, saoKpi: saoKpiData, availableCadences: cadences },
    });
    // Reuniões realizadas buscadas UMA vez e compartilhadas pelos dois KPIs.
    expect(mockFetchHeld).toHaveBeenCalledTimes(1);
    const heldPromise = mockFetchHeld.mock.results[0]?.value;
    expect(mockFetchKpi.mock.calls[0]?.[3]).toBe(heldPromise);
    expect(mockFetchSaoKpi.mock.calls[0]?.[3]).toBe(heldPromise);
  });

  it('should return error for invalid month format', async () => {
    const result = await getDashboardData({
      month: 'invalid',
      cadenceIds: [],
      userIds: [],
    });

    expect(result).toEqual({
      success: false,
      error: 'Filtros inválidos',
    });
  });

  it('should return error for invalid cadenceIds (not uuid)', async () => {
    const result = await getDashboardData({
      month: '2026-02',
      cadenceIds: ['not-a-uuid'],
      userIds: [],
    });

    expect(result).toEqual({
      success: false,
      error: 'Filtros inválidos',
    });
  });

  it('should throw when org not found (redirect)', async () => {
    mockRequireAuthWithMember.mockRejectedValue(new Error('NEXT_REDIRECT'));

    await expect(getDashboardData(validFilters)).rejects.toThrow('NEXT_REDIRECT');
  });

  it('should return error when service throws', async () => {
    mockFetchKpi.mockRejectedValue(new Error('DB connection failed'));

    const result = await getDashboardData(validFilters);

    expect(result).toEqual({
      success: false,
      error: 'Erro ao buscar dados do dashboard',
    });
  });

  it('should pass org_id and filters to service functions', async () => {
    mockRequireAuthWithMember.mockResolvedValue({ userId: 'user-1', orgId: 'org-42', role: 'manager' });

    mockFetchKpi.mockResolvedValue({
      totalOpportunities: 0,
      monthTarget: 0,
      conversionTarget: 0,
      percentOfTarget: 0,
      currentDay: 1,
      daysInMonth: 28,
      dailyData: [],
    });
    mockFetchCadences.mockResolvedValue([]);

    await getDashboardData(validFilters);

    expect(mockFetchKpi).toHaveBeenCalledWith(
      mockSupabase,
      'org-42',
      validFilters,
      expect.anything(), // promise compartilhada de reuniões realizadas
    );
    expect(mockFetchSaoKpi).toHaveBeenCalledWith(
      mockSupabase,
      'org-42',
      validFilters,
      expect.anything(),
    );
    expect(mockFetchCadences).toHaveBeenCalledWith(mockSupabase, 'org-42');
  });

  it('should accept valid uuid in cadenceIds', async () => {
    mockFetchKpi.mockResolvedValue({
      totalOpportunities: 0,
      monthTarget: 0,
      conversionTarget: 0,
      percentOfTarget: 0,
      currentDay: 1,
      daysInMonth: 28,
      dailyData: [],
    });
    mockFetchCadences.mockResolvedValue([]);

    const filters = {
      month: '2026-02',
      cadenceIds: ['550e8400-e29b-41d4-a716-446655440000'],
      userIds: [],
    };

    const result = await getDashboardData(filters);

    expect(result.success).toBe(true);
  });
});
