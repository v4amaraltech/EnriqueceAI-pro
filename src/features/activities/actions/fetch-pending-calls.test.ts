import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
}));

function createChainMock() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

// getAuthOrgIdResult() queries organization_members first; return a valid org
// so the action proceeds to the queries under test.
function orgMemberChain() {
  const chain = createChainMock();
  chain.single = vi.fn().mockResolvedValue({ data: { org_id: 'org-1' }, error: null });
  return chain;
}

let enrollmentsChain: ReturnType<typeof createChainMock>;
let stepsChain: ReturnType<typeof createChainMock>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(() => {
    return Promise.resolve({
      from: (table: string) => {
        if (table === 'organization_members') return orgMemberChain();
        if (table === 'cadence_enrollments') return enrollmentsChain;
        if (table === 'cadence_steps') return stepsChain;
        return createChainMock();
      },
    });
  }),
}));

import { fetchPendingCalls } from './fetch-pending-calls';

describe('fetchPendingCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enrollmentsChain = createChainMock();
    stepsChain = createChainMock();
  });

  it('should return empty array when no enrollments', async () => {
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await fetchPendingCalls();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it('should return empty array on error', async () => {
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: 'db error' },
    });

    const result = await fetchPendingCalls();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it('should filter only phone step enrollments', async () => {
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          id: 'enr-1',
          cadence_id: 'cad-1',
          lead_id: 'lead-1',
          current_step: 2,
          next_step_due: '2026-02-21T10:00:00Z',
          lead: { id: 'lead-1', nome_fantasia: 'Acme Corp', razao_social: null, cnpj: '12345' },
        },
        {
          id: 'enr-2',
          cadence_id: 'cad-1',
          lead_id: 'lead-2',
          current_step: 1,
          next_step_due: '2026-02-21T09:00:00Z',
          lead: { id: 'lead-2', nome_fantasia: null, razao_social: 'Beta SA', cnpj: '67890' },
        },
      ],
      error: null,
    });

    // Only step 2 of cad-1 is a phone step
    (stepsChain.eq as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ cadence_id: 'cad-1', step_order: 2, channel: 'phone' }],
    });

    const result = await fetchPendingCalls();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.enrollmentId).toBe('enr-1');
      expect(result.data[0]!.leadName).toBe('Acme Corp');
    }
  });

  it('should use razao_social as fallback for leadName', async () => {
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          id: 'enr-1',
          cadence_id: 'cad-1',
          lead_id: 'lead-1',
          current_step: 1,
          next_step_due: '2026-02-21T10:00:00Z',
          lead: { id: 'lead-1', nome_fantasia: null, razao_social: 'Razão Social Ltda', cnpj: '111' },
        },
      ],
      error: null,
    });

    (stepsChain.eq as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ cadence_id: 'cad-1', step_order: 1, channel: 'phone' }],
    });

    const result = await fetchPendingCalls();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]!.leadName).toBe('Razão Social Ltda');
    }
  });

  it('should skip enrollments without lead', async () => {
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          id: 'enr-1',
          cadence_id: 'cad-1',
          lead_id: 'lead-1',
          current_step: 1,
          next_step_due: '2026-02-21T10:00:00Z',
          lead: null,
        },
      ],
      error: null,
    });

    (stepsChain.eq as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ cadence_id: 'cad-1', step_order: 1, channel: 'phone' }],
    });

    const result = await fetchPendingCalls();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });
});
