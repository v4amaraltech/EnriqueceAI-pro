import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-manager', () => ({
  requireManager: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
}));

function createChainMock() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockReturnValue(chain);
  return chain;
}

let orgMemberChain: ReturnType<typeof createChainMock>;
let goalsChain: ReturnType<typeof createChainMock>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(() => {
    return Promise.resolve({
      from: (table: string) => {
        if (table === 'organization_members') {
          // Return different chains for getOrgId vs member list
          return orgMemberChain;
        }
        if (table === 'daily_activity_goals') return goalsChain;
        return createChainMock();
      },
    });
  }),
}));

const USERS_BY_ID: Record<string, { id: string; email: string }> = {
  'user-1': { id: 'user-1', email: 'alice@test.com' },
  'user-2': { id: 'user-2', email: 'bob@test.com' },
};

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn().mockReturnValue({
    auth: {
      admin: {
        getUserById: vi.fn().mockImplementation((id: string) =>
          Promise.resolve({ data: { user: USERS_BY_ID[id] ?? null } }),
        ),
      },
    },
  }),
}));

import { getDailyGoals } from './get-daily-goals';

describe('getDailyGoals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgMemberChain = createChainMock();
    goalsChain = createChainMock();

    // Default: org found, return org_id then members
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { org_id: 'org-1' } });
    // Members query returns via order chain
    (orgMemberChain.order as ReturnType<typeof vi.fn>).mockReturnValue({ data: [] });
    // Goals query
    Object.assign(goalsChain, { data: [] });
  });

  it('should return error when org not found', async () => {
    (orgMemberChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });
    const result = await getDailyGoals();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('Organização não encontrada');
  });

  it('should return default 20 when no org goal exists', async () => {
    const result = await getDailyGoals();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orgDefault).toBe(20);
    }
  });

  it('should return org default from goals table', async () => {
    Object.assign(goalsChain, { data: [{ id: 'g-1', user_id: null, target: 30 }] });
    const result = await getDailyGoals();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orgDefault).toBe(30);
    }
  });

  it('should return member goals with user names from admin API', async () => {
    (orgMemberChain.order as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        { user_id: 'user-1', role: 'manager' },
        { user_id: 'user-2', role: 'sdr' },
      ],
    });
    Object.assign(goalsChain, {
      data: [
        { id: 'g-1', user_id: null, target: 20 },
        { id: 'g-2', user_id: 'user-2', target: 15 },
      ],
    });

    const result = await getDailyGoals();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.members).toHaveLength(2);
      expect(result.data.members[0]!.name).toBe('alice');
      expect(result.data.members[0]!.target).toBeNull(); // uses org default
      expect(result.data.members[1]!.name).toBe('bob');
      expect(result.data.members[1]!.target).toBe(15);
    }
  });
});
