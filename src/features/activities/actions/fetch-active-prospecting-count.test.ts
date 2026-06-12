import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
}));

function createChainMock() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockReturnValue(chain);
  return chain;
}

let orgMemberChain: ReturnType<typeof createChainMock>;
let enrollmentsChain: ReturnType<typeof createChainMock>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(() => {
    return Promise.resolve({
      from: (table: string) => {
        if (table === 'organization_members') return orgMemberChain;
        if (table === 'cadence_enrollments') return enrollmentsChain;
        return createChainMock();
      },
    });
  }),
}));

import { fetchActiveProspectingCount } from './fetch-active-prospecting-count';

describe('fetchActiveProspectingCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgMemberChain = createChainMock();
    enrollmentsChain = createChainMock();
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
  });

  it('returns error when user has no org', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });

    const result = await fetchActiveProspectingCount();
    expect(result.success).toBe(false);
  });

  it('counts distinct leads across active enrollments', async () => {
    // Two enrollments for the same lead must collapse to one.
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        { lead_id: 'lead-a' },
        { lead_id: 'lead-a' },
        { lead_id: 'lead-b' },
        { lead_id: 'lead-c' },
      ],
      error: null,
    });

    const result = await fetchActiveProspectingCount();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(3);
    }
  });

  it('returns 0 when there are no active enrollments', async () => {
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [], error: null });

    const result = await fetchActiveProspectingCount();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(0);
    }
  });

  it('filters out auto_email cadences and active status via the query', async () => {
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [{ lead_id: 'lead-a' }], error: null });

    await fetchActiveProspectingCount();

    expect(enrollmentsChain.eq).toHaveBeenCalledWith('status', 'active');
    expect(enrollmentsChain.neq).toHaveBeenCalledWith('cadences.type', 'auto_email');
  });
});
