import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';
const mockFrom = mockSupabaseFrom as any;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() =>
    Promise.resolve({ from: mockFrom }),
  ),
}));

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn(() => Promise.resolve({ id: 'user-1', email: 'test@test.com' })),
}));

const mockListUsers = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    auth: {
      admin: {
        listUsers: mockListUsers,
      },
    },
  })),
}));

import { fetchOrgMembersAuth } from './fetch-org-members';

function makeOrgMemberChain(orgId: string | null) {
  const singleMock = vi.fn().mockResolvedValue({ data: orgId ? { org_id: orgId } : null });
  const eqStatusMock = vi.fn().mockReturnValue({ single: singleMock });
  const eqUserMock = vi.fn().mockReturnValue({ eq: eqStatusMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqUserMock });
  return { select: selectMock };
}

function makeMembersListChain(members: Array<{ user_id: string }> | null) {
  const eqStatusMock = vi.fn().mockResolvedValue({ data: members });
  const eqOrgMock = vi.fn().mockReturnValue({ eq: eqStatusMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqOrgMock });
  return { select: selectMock };
}

describe('fetchOrgMembersAuth', () => {
  beforeEach(() => {
    resetMocks();
    mockListUsers.mockResolvedValue({
      data: {
        users: [
          { id: 'user-1', email: 'alice@company.com', user_metadata: { full_name: 'Alice Silva' } },
          { id: 'user-2', email: 'bob@company.com', user_metadata: { full_name: 'Bob Santos' } },
          { id: 'user-3', email: 'charlie@other.com', user_metadata: { full_name: 'Charlie Lima' } },
        ],
      },
    });
  });

  it('should return org members with emails', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      return makeMembersListChain([{ user_id: 'user-1' }, { user_id: 'user-2' }]);
    });

    const result = await fetchOrgMembersAuth();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({ userId: 'user-1', email: 'alice@company.com', name: 'Alice Silva' });
      expect(result.data[1]).toEqual({ userId: 'user-2', email: 'bob@company.com', name: 'Bob Santos' });
    }
  });

  it('should return error when org not found', async () => {
    mockFrom.mockImplementation(() => makeOrgMemberChain(null));

    const result = await fetchOrgMembersAuth();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Organização não encontrada');
    }
  });

  it('should return empty array when org has no members', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      return makeMembersListChain([]);
    });

    const result = await fetchOrgMembersAuth();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it('should fallback to truncated user_id when admin client fails', async () => {
    mockListUsers.mockRejectedValue(new Error('Admin client unavailable'));

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      return makeMembersListChain([{ user_id: 'abcdef12-3456-7890-abcd-ef1234567890' }]);
    });

    const result = await fetchOrgMembersAuth();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.email).toBe('abcdef12');
      expect(result.data[0]?.name).toBe('abcdef12');
    }
  });

  it('should only return members that match org user_ids', async () => {
    // user-3 exists in auth but not in org members
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      return makeMembersListChain([{ user_id: 'user-1' }]);
    });

    const result = await fetchOrgMembersAuth();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.userId).toBe('user-1');
    }
  });
});
