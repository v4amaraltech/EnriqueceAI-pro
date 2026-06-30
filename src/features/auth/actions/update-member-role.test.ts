import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, resetMocks } from '@tests/mocks/supabase';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((...args: unknown[]) => {
    throw new Error('NEXT_REDIRECT: ' + args[0]);
  }),
}));

// getManagerOrgId encapsula requireManager + org do caller; mockamos direto para
// desacoplar o teste do internamento (a action escopa as escritas por essa org).
vi.mock('@/lib/auth/get-org-id', () => ({
  getManagerOrgId: vi.fn(),
}));

import { getManagerOrgId } from '@/lib/auth/get-org-id';
import { updateMemberRole } from './update-member-role';

const mockedGetManagerOrgId = vi.mocked(getManagerOrgId);

function makeFormData(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(data)) {
    fd.set(key, value);
  }
  return fd;
}

// from sequence (após getManagerOrgId mockado): #1 member, #2 owner, #3 update.
// O update encadeia DOIS .eq() (id + org_id, defense-in-depth).
function setupMemberMocks(member: { user_id: string; org_id: string }, ownerId: string) {
  let fromCallCount = 0;
  mockSupabase.from.mockImplementation(() => {
    fromCallCount++;

    if (fromCallCount === 1) {
      const singleMock = vi.fn().mockResolvedValue({ data: member });
      const eqMock1 = vi.fn().mockReturnValue({ single: singleMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock1 });
      return { select: selectMock, update: vi.fn(), insert: vi.fn(), delete: vi.fn(), eq: vi.fn(), single: vi.fn() };
    }

    if (fromCallCount === 2) {
      const singleMock = vi.fn().mockResolvedValue({ data: { owner_id: ownerId } });
      const eqMock1 = vi.fn().mockReturnValue({ single: singleMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock1 });
      return { select: selectMock, update: vi.fn(), insert: vi.fn(), delete: vi.fn(), eq: vi.fn(), single: vi.fn() };
    }

    if (fromCallCount === 3) {
      // Update role — .update().eq('id').eq('org_id')
      const eq2Mock = vi.fn().mockResolvedValue({ error: null });
      const eq1Mock = vi.fn().mockReturnValue({ eq: eq2Mock });
      const updateMock = vi.fn().mockReturnValue({ eq: eq1Mock });
      return { select: vi.fn(), update: updateMock, insert: vi.fn(), delete: vi.fn(), eq: vi.fn(), single: vi.fn() };
    }

    return { select: vi.fn().mockReturnThis(), update: vi.fn(), insert: vi.fn(), delete: vi.fn(), eq: vi.fn().mockReturnThis(), single: vi.fn() };
  });
}

describe('updateMemberRole', () => {
  beforeEach(() => {
    resetMocks();
    mockedGetManagerOrgId.mockResolvedValue({
      orgId: 'org-abc',
      userId: 'user-123',
      supabase: mockSupabase,
    } as unknown as Awaited<ReturnType<typeof getManagerOrgId>>);
  });

  it('should return validation error for invalid role', async () => {
    const result = await updateMemberRole(
      makeFormData({ memberId: '550e8400-e29b-41d4-a716-446655440000', role: 'admin' }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Role');
    }
  });

  it('should prevent changing role of org owner', async () => {
    setupMemberMocks({ user_id: 'owner-user', org_id: 'org-abc' }, 'owner-user');

    const result = await updateMemberRole(
      makeFormData({ memberId: '550e8400-e29b-41d4-a716-446655440000', role: 'sdr' }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('proprietário');
    }
  });

  it('should reject a member from another org', async () => {
    setupMemberMocks({ user_id: 'other-user', org_id: 'org-OTHER' }, 'user-123');

    const result = await updateMemberRole(
      makeFormData({ memberId: '550e8400-e29b-41d4-a716-446655440000', role: 'sdr' }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('não encontrado');
    }
  });

  it('should succeed with valid data', async () => {
    setupMemberMocks({ user_id: 'other-user', org_id: 'org-abc' }, 'user-123');

    const result = await updateMemberRole(
      makeFormData({ memberId: '550e8400-e29b-41d4-a716-446655440000', role: 'sdr' }),
    );

    expect(result.success).toBe(true);
  });
});
