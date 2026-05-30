import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCallDetail } from './get-call-detail';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

function createChainMock(resolvedValue: unknown = { data: null, error: null }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'eq', 'order', 'single'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = vi.fn((resolve) => resolve(resolvedValue));
  return chain;
}

// getAuthOrgIdResult -> fetchOrgId: organization_members.select('org_id').eq().eq().single()
function makeOrgIdChain(orgId: string | null = 'org-1') {
  const singleMock = vi.fn().mockResolvedValue({ data: orgId ? { org_id: orgId } : null });
  const eq2 = vi.fn().mockReturnValue({ single: singleMock });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const selectMock = vi.fn().mockReturnValue({ eq: eq1 });
  return { select: selectMock };
}

const CALL_UUID = '550e8400-e29b-41d4-a716-446655440000';

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

describe('getCallDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return call with feedback', async () => {
    // Single joined query: calls.select('*, call_feedback(*)') embeds feedback.
    const callChain = createChainMock({
      data: {
        id: CALL_UUID,
        origin: '11999991111',
        destination: '11888882222',
        status: 'significant',
        duration_seconds: 120,
        started_at: '2026-02-21T10:00:00Z',
        call_feedback: [
          { id: 'fb-1', call_id: CALL_UUID, user_id: 'user-1', content: 'Nice', created_at: '2026-02-21T11:00:00Z' },
        ],
      },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return makeOrgIdChain('org-1');
      if (table === 'calls') return callChain;
      return createChainMock();
    });

    const result = await getCallDetail(CALL_UUID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(CALL_UUID);
      expect(result.data.feedback).toHaveLength(1);
      expect(result.data.feedback[0]!.content).toBe('Nice');
    }
  });

  it('should return call with empty feedback', async () => {
    const callChain = createChainMock({
      data: { id: CALL_UUID, origin: '11999991111', destination: '11888882222', call_feedback: null },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return makeOrgIdChain('org-1');
      if (table === 'calls') return callChain;
      return createChainMock();
    });

    const result = await getCallDetail(CALL_UUID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.feedback).toEqual([]);
    }
  });

  it('should return error when call not found', async () => {
    const callChain = createChainMock({ data: null, error: { message: 'Not found' } });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return makeOrgIdChain('org-1');
      return callChain;
    });

    const result = await getCallDetail(CALL_UUID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Ligação não encontrada');
    }
  });

  it('should return error for invalid call id', async () => {
    const result = await getCallDetail('nonexistent');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('ID inválido');
    }
  });
});
