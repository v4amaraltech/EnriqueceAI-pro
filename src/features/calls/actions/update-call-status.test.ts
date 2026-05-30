import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateCallStatus } from './update-call-status';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

function createChainMock(resolvedValue: unknown = { data: null, error: null }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['update', 'eq', 'single'];
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

// Route the org-id lookup vs. the calls update by table name. Tests set
// `callsChain` to control the calls update result.
let callsChain: ReturnType<typeof createChainMock>;
function installFromRouter() {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'organization_members') return makeOrgIdChain('org-1');
    return callsChain;
  });
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

describe('updateCallStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callsChain = createChainMock({ error: null });
    installFromRouter();
  });

  it('should update status successfully', async () => {
    callsChain = createChainMock({ error: null });

    const result = await updateCallStatus({
      id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'significant',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    }
  });

  it('should return error for invalid input', async () => {
    const result = await updateCallStatus({ id: 'not-uuid', status: 'invalid' as never });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Dados inválidos');
    }
  });

  it('should return error on db failure', async () => {
    callsChain = createChainMock({ error: { message: 'DB error' } });

    const result = await updateCallStatus({
      id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'busy',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Erro ao atualizar status');
    }
  });
});
