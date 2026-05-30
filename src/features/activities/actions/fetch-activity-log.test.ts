import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchActivityLog } from './fetch-activity-log';

// Mock auth
vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

// Chain mock helper
function createChainMock(resolvedValue: unknown = { data: null, error: null }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'eq', 'neq', 'in', 'is', 'not', 'lte', 'gte', 'order', 'limit', 'single', 'range'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Terminal call returns resolved value
  chain.then = vi.fn((resolve) => resolve(resolvedValue));
  return chain;
}

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

// getAuthOrgIdResult() queries organization_members first; this chain returns a
// valid org so the action proceeds to the query under test.
function orgMemberChain() {
  return createChainMock({ data: { org_id: 'org-1' }, error: null });
}

/**
 * Route the enrollment chain by table, prepending the organization_members
 * lookup consumed by getAuthOrgIdResult().
 */
function routeEnrollment(enrollmentChain: ReturnType<typeof createChainMock>) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'organization_members') return orgMemberChain();
    return enrollmentChain;
  });
}

describe('fetchActivityLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when no enrollments found', async () => {
    const enrollmentChain = createChainMock({ data: [], count: 0, error: null });
    routeEnrollment(enrollmentChain);

    const result = await fetchActivityLog({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activities).toEqual([]);
      expect(result.data.total).toBe(0);
    }
  });

  it('should return error when query fails', async () => {
    const enrollmentChain = createChainMock({ data: null, count: null, error: { message: 'DB error' } });
    routeEnrollment(enrollmentChain);

    const result = await fetchActivityLog({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Erro ao buscar atividades');
    }
  });

  it('should fetch enrollments without next_step_due filter (shows all)', async () => {
    const enrollmentChain = createChainMock({ data: [], count: 0, error: null });
    routeEnrollment(enrollmentChain);

    await fetchActivityLog({});

    // Should call eq('status', 'active') but NOT lte('next_step_due', ...)
    expect(enrollmentChain.eq).toHaveBeenCalledWith('status', 'active');
    expect(enrollmentChain.not).toHaveBeenCalledWith('next_step_due', 'is', null);
    // Should NOT filter by due date (key difference from fetchPendingActivities)
    expect(enrollmentChain.lte).not.toHaveBeenCalled();
  });

  it('should pass search filter through', async () => {
    const enrollmentChain = createChainMock({
      data: [
        {
          id: 'enr-1',
          cadence_id: 'cad-1',
          lead_id: 'lead-1',
          current_step: 1,
          status: 'active',
          next_step_due: new Date().toISOString(),
          lead: {
            id: 'lead-1',
            org_id: 'org-1',
            nome_fantasia: 'Alpha Corp',
            razao_social: null,
            cnpj: '11222333000181',
            email: 'alpha@test.com',
            telefone: null,
            municipio: null,
            uf: null,
            porte: null,
          },
          cadence: { id: 'cad-1', name: 'Cadence 1', total_steps: 3, created_by: 'user-1' },
        },
      ],
      count: 1,
      error: null,
    });

    const stepsChain = createChainMock({
      data: [
        {
          id: 'step-1',
          cadence_id: 'cad-1',
          step_order: 1,
          channel: 'email',
          template_id: null,
          ai_personalization: false,
          delay_days: 0,
          delay_hours: 0,
        },
      ],
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return orgMemberChain();
      if (table === 'cadence_enrollments') return enrollmentChain;
      if (table === 'cadence_steps') return stepsChain;
      return createChainMock();
    });

    // Search for 'alpha' should match
    const result = await fetchActivityLog({ search: 'alpha' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activities.length).toBe(1);
    }

    // Search for 'nonexistent' should not match
    const result2 = await fetchActivityLog({ search: 'nonexistent' });
    expect(result2.success).toBe(true);
    if (result2.success) {
      expect(result2.data.activities.length).toBe(0);
    }
  });
});
