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
const mockListUsers = vi.fn().mockResolvedValue({ data: { users: [] } });
const mockAdminInsert = vi.fn().mockResolvedValue({ error: null });
const mockAdminUpsert = vi.fn().mockResolvedValue({ error: null });
const mockAdminFrom = vi.fn().mockReturnValue({ insert: mockAdminInsert, upsert: mockAdminUpsert });

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    auth: { admin: { inviteUserByEmail: mockInviteUserByEmail, listUsers: mockListUsers } },
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

  let fromCallCount = 0;
  mockSupabase.from.mockImplementation(() => {
    fromCallCount++;

    if (fromCallCount === 1) {
      // requireManager: organization_members -> role check
      const singleMock = vi.fn().mockResolvedValue({ data: { role: 'manager' } });
      const eqMock2 = vi.fn().mockReturnValue({ single: singleMock });
      const eqMock1 = vi.fn().mockReturnValue({ eq: eqMock2 });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock1 });
      return { select: selectMock, update: vi.fn(), insert: vi.fn(), delete: vi.fn(), eq: vi.fn(), single: vi.fn() };
    }

    if (fromCallCount === 2) {
      // Get current user's org
      const singleMock = vi.fn().mockResolvedValue({ data: { org_id: 'org-abc' } });
      const eqMock2 = vi.fn().mockReturnValue({ single: singleMock });
      const eqMock1 = vi.fn().mockReturnValue({ eq: eqMock2 });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock1 });
      return { select: selectMock, update: vi.fn(), insert: vi.fn(), delete: vi.fn(), eq: vi.fn(), single: vi.fn() };
    }

    if (fromCallCount === 3) {
      // checkMemberLimit: subscriptions -> select().eq().single()
      const singleMock = vi.fn().mockResolvedValue({
        data: { plan_id: 'plan-1', plans: { included_users: 5 } },
      });
      const eqMock = vi.fn().mockReturnValue({ single: singleMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      return { select: selectMock, update: vi.fn(), insert: vi.fn(), delete: vi.fn(), eq: vi.fn(), single: vi.fn() };
    }

    if (fromCallCount === 4) {
      // checkMemberLimit: count -> select().eq().in()
      const inMock = vi.fn().mockResolvedValue({ count: 2 });
      const eqMock = vi.fn().mockReturnValue({ in: inMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      return { select: selectMock, update: vi.fn(), insert: vi.fn(), delete: vi.fn(), eq: vi.fn(), single: vi.fn() };
    }

    return { select: vi.fn().mockReturnThis(), update: vi.fn(), insert: vi.fn(), delete: vi.fn(), eq: vi.fn().mockReturnThis(), single: vi.fn() };
  });
}

describe('inviteMember', () => {
  beforeEach(() => {
    resetMocks();
    mockInviteUserByEmail.mockReset();
    mockListUsers.mockReset().mockResolvedValue({ data: { users: [] } });
    mockAdminInsert.mockReset().mockResolvedValue({ error: null });
    mockAdminUpsert.mockReset().mockResolvedValue({ error: null });
    mockAdminFrom.mockReset().mockReturnValue({ insert: mockAdminInsert, upsert: mockAdminUpsert });
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

  it('should succeed when inviting a new user', async () => {
    setupManagerWithOrg();
    mockInviteUserByEmail.mockResolvedValue({
      data: { user: { id: 'new-user-id' } },
      error: null,
    });

    const result = await inviteMember(makeFormData({ email: 'new@email.com', role: 'sdr' }));

    expect(result.success).toBe(true);
    expect(mockInviteUserByEmail).toHaveBeenCalledWith(
      'new@email.com',
      expect.objectContaining({
        data: expect.objectContaining({
          invited_to_org: 'org-abc',
          invited_role: 'sdr',
        }),
      }),
    );
    expect(mockAdminFrom).toHaveBeenCalledWith('organization_members');
    expect(mockAdminInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-abc',
        user_id: 'new-user-id',
        role: 'sdr',
        status: 'invited',
      }),
    );
  });

  it('should fall back to OTP for existing users', async () => {
    setupManagerWithOrg();
    mockInviteUserByEmail.mockResolvedValue({
      data: null,
      error: { message: 'User has already been registered', code: 'email_exists' },
    });
    mockSupabaseAuth.signInWithOtp.mockResolvedValue({ error: null });
    mockListUsers.mockResolvedValue({
      data: { users: [{ id: 'existing-user-id', email: 'existing@email.com' }] },
    });

    const result = await inviteMember(makeFormData({ email: 'existing@email.com', role: 'sdr' }));

    expect(result.success).toBe(true);
    expect(mockSupabaseAuth.signInWithOtp).toHaveBeenCalled();
    expect(mockAdminUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-abc',
        user_id: 'existing-user-id',
        role: 'sdr',
        status: 'invited',
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
