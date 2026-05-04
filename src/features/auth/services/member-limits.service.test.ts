import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkMemberLimit } from './member-limits.service';

function createMockSupabase(
  subscriptionData: unknown,
  memberCount: number,
  organizationData: unknown = { member_limit_override: null },
) {
  const subscriptionSingle = vi.fn().mockResolvedValue({ data: subscriptionData });
  const organizationSingle = vi.fn().mockResolvedValue({ data: organizationData });
  const memberInMock = vi.fn().mockResolvedValue({ count: memberCount });

  return {
    from: vi.fn((table: string) => {
      if (table === 'subscriptions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: subscriptionSingle,
            }),
          }),
        };
      }
      if (table === 'organizations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: organizationSingle,
            }),
          }),
        };
      }
      // organization_members
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: memberInMock,
          }),
        }),
      };
    }),
  };
}

describe('checkMemberLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should allow when under limit', async () => {
    const supabase = createMockSupabase({ plan_id: 'plan-1', plans: { included_users: 4 } }, 2);

    const result = await checkMemberLimit(supabase as any, 'org-123');

    expect(result).toEqual({ allowed: true, current: 2, max: 4 });
  });

  it('should not allow when at limit', async () => {
    const supabase = createMockSupabase({ plan_id: 'plan-1', plans: { included_users: 4 } }, 4);

    const result = await checkMemberLimit(supabase as any, 'org-123');

    expect(result).toEqual({ allowed: false, current: 4, max: 4 });
  });

  it('should default to 4 max when no subscription found', async () => {
    const supabase = createMockSupabase(null, 1);

    const result = await checkMemberLimit(supabase as any, 'org-123');

    expect(result).toEqual({ allowed: true, current: 1, max: 4 });
  });

  it('should use member_limit_override when set, ignoring plan included_users', async () => {
    const supabase = createMockSupabase(
      { plan_id: 'plan-1', plans: { included_users: 4 } },
      6,
      { member_limit_override: 10 },
    );

    const result = await checkMemberLimit(supabase as any, 'org-123');

    expect(result).toEqual({ allowed: true, current: 6, max: 10 });
  });

  it('should block when current reaches override', async () => {
    const supabase = createMockSupabase(
      { plan_id: 'plan-1', plans: { included_users: 4 } },
      10,
      { member_limit_override: 10 },
    );

    const result = await checkMemberLimit(supabase as any, 'org-123');

    expect(result).toEqual({ allowed: false, current: 10, max: 10 });
  });
});
