import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, mockSupabaseAuth, resetMocks } from '@tests/mocks/supabase';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((...args: unknown[]) => {
    throw new Error('NEXT_REDIRECT: ' + args[0]);
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

const mockInviteUserByEmail = vi.fn();
// Existing-org members the admin client iterates over to find an existing user
// by email. Each entry's user_id is resolved via getUserById.
let adminExistingMembers: Array<{ user_id: string }> = [];
const mockGetUserById = vi.fn();
const mockAdminInsert = vi.fn().mockResolvedValue({ error: null });
const mockAdminUpsert = vi.fn().mockResolvedValue({ error: null });
const mockAdminDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

// Admin select on organization_members serves two flows:
//  - existing-user lookup: select('user_id').eq('status','active')  (awaited array)
//  - auto-org lookup:       select('org_id').eq().eq().eq().single()
function makeAdminMembersSelect() {
  return vi.fn().mockImplementation((cols: string) => {
    if (cols === 'org_id') {
      const singleMock = vi.fn().mockResolvedValue({ data: { org_id: 'auto-org-id' } });
      const eq3 = vi.fn().mockReturnValue({ single: singleMock });
      const eq2 = vi.fn().mockReturnValue({ eq: eq3 });
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
      return { eq: eq1 };
    }
    // existing-user lookup: .eq('status','active') resolves to the members array
    const eqMock = vi.fn().mockResolvedValue({ data: adminExistingMembers });
    return { eq: eqMock };
  });
}

const mockAdminFrom = vi.fn().mockImplementation((table: string) => {
  if (table === 'organizations') {
    return { delete: mockAdminDelete };
  }
  return { insert: mockAdminInsert, upsert: mockAdminUpsert, select: makeAdminMembersSelect() };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    auth: {
      admin: {
        inviteUserByEmail: mockInviteUserByEmail,
        getUserById: mockGetUserById,
      },
    },
    from: mockAdminFrom,
  })),
}));

vi.mock('@/features/notifications/services/notification.service', () => ({
  createNotificationsForOrgMembers: vi.fn().mockResolvedValue(undefined),
}));

import { inviteMember } from './invite-member';

function makeFormData(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(data)) {
    fd.set(key, value);
  }
  return fd;
}

function setupManagerWithOrg() {
  mockSupabaseAuth.getUser.mockResolvedValue({
    data: { user: { id: 'user-123' } },
  });

  // Dispatch by table + select columns, since checkMemberLimit runs three
  // server-client queries in parallel (non-deterministic call order).
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'organization_members') {
      // The select column disambiguates the three uses of this table.
      const selectMock = vi.fn().mockImplementation((cols: string) => {
        if (cols === 'role') {
          // requireManager role check -> eq -> eq -> single
          const singleMock = vi.fn().mockResolvedValue({ data: { role: 'manager' } });
          const eqMock2 = vi.fn().mockReturnValue({ single: singleMock });
          const eqMock1 = vi.fn().mockReturnValue({ eq: eqMock2 });
          return { eq: eqMock1 };
        }
        if (cols === 'org_id') {
          // current user's org -> eq -> eq -> single
          const singleMock = vi.fn().mockResolvedValue({ data: { org_id: 'org-abc' } });
          const eqMock2 = vi.fn().mockReturnValue({ single: singleMock });
          const eqMock1 = vi.fn().mockReturnValue({ eq: eqMock2 });
          return { eq: eqMock1 };
        }
        // checkMemberLimit count -> select('*', {...}) -> eq -> in
        const inMock = vi.fn().mockResolvedValue({ count: 2 });
        const eqMock = vi.fn().mockReturnValue({ in: inMock });
        return { eq: eqMock };
      });
      return { select: selectMock, update: vi.fn(), insert: vi.fn(), delete: vi.fn(), eq: vi.fn(), single: vi.fn() };
    }

    if (table === 'subscriptions') {
      // checkMemberLimit: subscriptions -> select().eq().single()
      const singleMock = vi.fn().mockResolvedValue({
        data: { plan_id: 'plan-1', plans: { included_users: 5 } },
      });
      const eqMock = vi.fn().mockReturnValue({ single: singleMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      return { select: selectMock };
    }

    if (table === 'organizations') {
      // checkMemberLimit: organizations -> select().eq().single()
      const singleMock = vi.fn().mockResolvedValue({ data: { member_limit_override: null } });
      const eqMock = vi.fn().mockReturnValue({ single: singleMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      return { select: selectMock };
    }

    return { select: vi.fn().mockReturnThis(), update: vi.fn(), insert: vi.fn(), delete: vi.fn(), eq: vi.fn().mockReturnThis(), single: vi.fn() };
  });
}

describe('inviteMember', () => {
  beforeEach(() => {
    resetMocks();
    mockInviteUserByEmail.mockReset();
    adminExistingMembers = [];
    mockGetUserById.mockReset().mockResolvedValue({ data: { user: null } });
    mockAdminInsert.mockReset().mockResolvedValue({ error: null });
    mockAdminUpsert.mockReset().mockResolvedValue({ error: null });
    mockAdminDelete.mockReset().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mockAdminFrom.mockReset().mockImplementation((table: string) => {
      if (table === 'organizations') {
        return { delete: mockAdminDelete };
      }
      return { insert: mockAdminInsert, upsert: mockAdminUpsert, select: makeAdminMembersSelect() };
    });
  });

  it('should return validation error for invalid email', async () => {
    mockSupabaseAuth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    });
    const singleMock = vi.fn().mockResolvedValue({ data: { role: 'manager' } });
    const eqMock2 = vi.fn().mockReturnValue({ single: singleMock });
    const eqMock1 = vi.fn().mockReturnValue({ eq: eqMock2 });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock1 });
    mockSupabase.from.mockReturnValue({ select: selectMock, update: vi.fn(), insert: vi.fn(), delete: vi.fn(), eq: vi.fn(), single: vi.fn() });

    const result = await inviteMember(makeFormData({ email: 'not-an-email', role: 'sdr' }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Email');
    }
  });

  it('should return validation error for invalid role', async () => {
    mockSupabaseAuth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    });
    const singleMock = vi.fn().mockResolvedValue({ data: { role: 'manager' } });
    const eqMock2 = vi.fn().mockReturnValue({ single: singleMock });
    const eqMock1 = vi.fn().mockReturnValue({ eq: eqMock2 });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock1 });
    mockSupabase.from.mockReturnValue({ select: selectMock, update: vi.fn(), insert: vi.fn(), delete: vi.fn(), eq: vi.fn(), single: vi.fn() });

    const result = await inviteMember(makeFormData({ email: 'test@email.com', role: 'admin' }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Role');
    }
  });

  it('should invite new user via magic link without temp password', async () => {
    setupManagerWithOrg();
    mockInviteUserByEmail.mockResolvedValue({
      data: { user: { id: 'new-user-id' } },
      error: null,
    });

    const result = await inviteMember(makeFormData({ email: 'new@email.com', role: 'sdr' }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('new@email.com');
    }
    expect(mockInviteUserByEmail).toHaveBeenCalledWith(
      'new@email.com',
      expect.objectContaining({
        data: expect.objectContaining({
          invited_to_org: 'org-abc',
          invited_role: 'sdr',
        }),
      }),
    );
    expect(mockAdminInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-abc',
        user_id: 'new-user-id',
        role: 'sdr',
        status: 'invited',
        invited_expires_at: expect.any(String),
      }),
    );
  });

  it('should add existing user to org with active status', async () => {
    setupManagerWithOrg();
    adminExistingMembers = [{ user_id: 'existing-user-id' }];
    mockGetUserById.mockResolvedValue({
      data: { user: { id: 'existing-user-id', email: 'existing@email.com' } },
    });

    const result = await inviteMember(makeFormData({ email: 'existing@email.com', role: 'sdr' }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('existing@email.com');
    }
    expect(mockInviteUserByEmail).not.toHaveBeenCalled();
    expect(mockAdminUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-abc',
        user_id: 'existing-user-id',
        role: 'sdr',
        status: 'active',
      }),
      expect.objectContaining({ onConflict: 'org_id,user_id' }),
    );
  });

  it('should redirect if not a manager', async () => {
    mockSupabaseAuth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    });
    const singleMock = vi.fn().mockResolvedValue({ data: { role: 'sdr' } });
    const eqMock2 = vi.fn().mockReturnValue({ single: singleMock });
    const eqMock1 = vi.fn().mockReturnValue({ eq: eqMock2 });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock1 });
    mockSupabase.from.mockReturnValue({ select: selectMock, update: vi.fn(), insert: vi.fn(), delete: vi.fn(), eq: vi.fn(), single: vi.fn() });

    await expect(inviteMember(makeFormData({ email: 'x@y.com', role: 'sdr' }))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });
});
