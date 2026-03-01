import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
}));

function createChainMock() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.not = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockReturnValue(chain);
  return chain;
}

let orgMemberChain: ReturnType<typeof createChainMock>;
let interactionsChain: ReturnType<typeof createChainMock>;
let enrollmentsChain: ReturnType<typeof createChainMock>;
let goalsChain: ReturnType<typeof createChainMock>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(() => {
    return Promise.resolve({
      from: (table: string) => {
        if (table === 'organization_members') return orgMemberChain;
        if (table === 'interactions') return interactionsChain;
        if (table === 'cadence_enrollments') return enrollmentsChain;
        if (table === 'daily_activity_goals') return goalsChain;
        return createChainMock();
      },
    });
  }),
}));

import { fetchDailyProgress } from './fetch-daily-progress';

describe('fetchDailyProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgMemberChain = createChainMock();
    interactionsChain = createChainMock();
    enrollmentsChain = createChainMock();
    goalsChain = createChainMock();
  });

  it('should return error when user has no org', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });

    const result = await fetchDailyProgress();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Organização não encontrada');
    }
  });

  it('should return progress with default target when no goal exists', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    (interactionsChain.gte as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 5 });
    // enrollments: .select().eq().neq().not().limit() → returns { data: [] }
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    // No user goal
    (goalsChain.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: null })  // user-specific
      .mockResolvedValueOnce({ data: null }); // org default

    const result = await fetchDailyProgress();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.completed).toBe(5);
      expect(result.data.pending).toBe(0);
      expect(result.data.total).toBe(5);
      expect(result.data.target).toBe(20); // default
    }
  });

  it('should return user-specific goal target', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    (interactionsChain.gte as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 3 });
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    // User has specific goal
    (goalsChain.single as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { target: 30 } });

    const result = await fetchDailyProgress();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.target).toBe(30);
    }
  });

  it('should fallback to org default goal when no user goal', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    (interactionsChain.gte as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    (enrollmentsChain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    // No user goal, but org default exists
    (goalsChain.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: null })      // user-specific
      .mockResolvedValueOnce({ data: { target: 15 } }); // org default

    const result = await fetchDailyProgress();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.target).toBe(15);
    }
  });
});
