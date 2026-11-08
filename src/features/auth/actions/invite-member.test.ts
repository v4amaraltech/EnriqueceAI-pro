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
const mockGetUserById = vi.fn();
// find_user_id_by_email RPC — resolves an existing user by e-mail in one query.
const mockAdminRpc = vi.fn().mockResolvedValue({ data: null });
const mockAdminInsert = vi.fn().mockResolvedValue({ error: null });
const mockAdminUpsert = vi.fn().mockResolvedValue({ error: null });
const mockAdminDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

// Admin select on organization_members: the auto-org lookup (new-user branch)
// select('org_id').eq().eq().eq().single(). Existing-user detection is now the
// find_user_id_by_email RPC (mockAdminRpc), not a members loop.
function makeAdminMembersSelect() {
  return vi.fn().mockImplementation(() => {
    const singleMock = vi.fn().mockResolvedValue({ data: { org_id: 'auto-org-id' } });
    const eq3 = vi.fn().mockReturnValue({ single: singleMock });
    // membership lookup in the inviting org: .eq().eq().maybeSingle() -> none yet
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null });
    const eq2 = vi.fn().mockReturnValue({ eq: eq3, maybeSingle: maybeSingleMock });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    return { eq: eq1 };
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
    rpc: mockAdminRpc,
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
    mockAdminRpc.mockReset().mockResolvedValue({ data: null });
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

  it('existing user gets a PENDING invite (status invited), never active', async () => {
    setupManagerWithOrg();
    mockAdminRpc.mockResolvedValue({ data: 'existing-user-id' });

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
        status: 'invited',
        invited_expires_at: expect.any(String),
      }),
      expect.objectContaining({ onConflict: 'org_id,user_id' }),
    );
    expect(mockAdminUpsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
      expect.anything(),
    );
  });

  it('never deletes any organization when inviting an existing user', async () => {
    setupManagerWithOrg();
    mockAdminRpc.mockResolvedValue({ data: 'existing-user-id' });

    const result = await inviteMember(makeFormData({ email: 'existing@email.com', role: 'sdr' }));

    expect(result.success).toBe(true);
    expect(mockAdminDelete).not.toHaveBeenCalled();
  });

  it('rejects inviting someone who is already an active member of the org', async () => {
    setupManagerWithOrg();
    mockAdminRpc.mockResolvedValue({ data: 'existing-user-id' });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { status: 'active' } }),
              }),
            }),
          }),
          upsert: mockAdminUpsert,
          insert: mockAdminInsert,
        };
      }
      return { delete: mockAdminDelete };
    });

    const result = await inviteMember(makeFormData({ email: 'existing@email.com', role: 'sdr' }));

    expect(result.success).toBe(false);
    expect(mockAdminUpsert).not.toHaveBeenCalled();
    expect(mockAdminDelete).not.toHaveBeenCalled();
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
