import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addCallFeedback } from './add-call-feedback';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

function createChainMock(resolvedValue: unknown = { data: null, error: null }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['insert', 'select', 'single'];
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

const mockFrom = vi.fn();

// Route org-id lookup vs. the feedback insert by table name. Tests set
// `feedbackChain` to control the call_feedback result.
let feedbackChain: ReturnType<typeof createChainMock>;
function installFromRouter() {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'organization_members') return makeOrgIdChain('org-1');
    return feedbackChain;
  });
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

describe('addCallFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    feedbackChain = createChainMock();
    installFromRouter();
  });

  it('should add feedback successfully', async () => {
    feedbackChain = createChainMock({
      data: {
        id: 'fb-1',
        call_id: '550e8400-e29b-41d4-a716-446655440000',
        user_id: 'user-1',
        content: 'Great call',
        created_at: '2026-02-21T00:00:00Z',
      },
      error: null,
    });

    const result = await addCallFeedback({
      call_id: '550e8400-e29b-41d4-a716-446655440000',
      content: 'Great call',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe('Great call');
    }
  });

  it('should return error for empty content', async () => {
    const result = await addCallFeedback({
      call_id: '550e8400-e29b-41d4-a716-446655440000',
      content: '',
    });

    expect(result.success).toBe(false);
  });

  it('should return error for invalid call_id', async () => {
    const result = await addCallFeedback({
      call_id: 'not-uuid',
      content: 'Some feedback',
    });

    expect(result.success).toBe(false);
  });

  it('should return error on db failure', async () => {
    feedbackChain = createChainMock({ data: null, error: { message: 'DB error' } });

    const result = await addCallFeedback({
      call_id: '550e8400-e29b-41d4-a716-446655440000',
      content: 'Some feedback',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Erro ao adicionar feedback');
    }
  });
});
