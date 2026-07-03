import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCalls } from './get-calls';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

function createChainMock(resolvedValue: unknown = { data: null, error: null }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'eq', 'neq', 'in', 'is', 'not', 'gte', 'lte', 'or', 'order', 'range', 'single', 'limit'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = vi.fn((resolve) => resolve(resolvedValue));
  return chain;
}

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

describe('getCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return calls list with pagination', async () => {
    const memberChain = createChainMock({ data: { org_id: 'org-1' } });
    const callsChain = createChainMock({
      data: [
        { id: 'call-1', origin: '11999991111', destination: '11888882222', status: 'significant' },
      ],
      count: 1,
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      return callsChain;
    });

    const result = await getCalls({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toHaveLength(1);
      expect(result.data.total).toBe(1);
      expect(result.data.page).toBe(1);
      expect(result.data.per_page).toBe(20);
    }
  });

  it('should return error when org not found', async () => {
    const memberChain = createChainMock({ data: null });
    mockFrom.mockReturnValue(memberChain);

    const result = await getCalls({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Organização não encontrada');
    }
  });

  it('should return error on db failure', async () => {
    const memberChain = createChainMock({ data: { org_id: 'org-1' } });
    const callsChain = createChainMock({ data: null, count: null, error: { message: 'DB error' } });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      return callsChain;
    });

    const result = await getCalls({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Erro ao buscar ligações');
    }
  });

  it('should apply status filter', async () => {
    const memberChain = createChainMock({ data: { org_id: 'org-1' } });
    const callsChain = createChainMock({ data: [], count: 0, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      return callsChain;
    });

    await getCalls({ status: 'significant' });

    // eq called for org_id and status
    const eqCalls = callsChain.eq!.mock.calls;
    expect(eqCalls).toContainEqual(['org_id', 'org-1']);
    expect(eqCalls).toContainEqual(['status', 'significant']);
  });

  it('should apply provider filter for whatsapp', async () => {
    const memberChain = createChainMock({ data: { org_id: 'org-1' } });
    const callsChain = createChainMock({ data: [], count: 0, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      return callsChain;
    });

    await getCalls({ provider: 'whatsapp' });

    expect(callsChain.eq!.mock.calls).toContainEqual(['metadata->>provider', 'whatsapp']);
  });

  it('should apply provider filter for api4com (not whatsapp)', async () => {
    const memberChain = createChainMock({ data: { org_id: 'org-1' } });
    const callsChain = createChainMock({ data: [], count: 0, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      return callsChain;
    });

    await getCalls({ provider: 'api4com' });

    expect(callsChain.or).toHaveBeenCalledWith(
      expect.stringContaining('metadata->>provider.neq.whatsapp'),
    );
  });

  it('should apply period filter for today', async () => {
    const memberChain = createChainMock({ data: { org_id: 'org-1' } });
    const callsChain = createChainMock({ data: [], count: 0, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      return callsChain;
    });

    await getCalls({ period: 'today' });

    expect(callsChain.gte).toHaveBeenCalledWith('started_at', expect.any(String));
  });

  it('should apply search filter', async () => {
    const memberChain = createChainMock({ data: { org_id: 'org-1' } });
    const callsChain = createChainMock({ data: [], count: 0, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      return callsChain;
    });

    await getCalls({ search: 'test' });

    expect(callsChain.or).toHaveBeenCalledWith(
      expect.stringContaining('test'),
    );
  });

  it('should apply important_only filter', async () => {
    const memberChain = createChainMock({ data: { org_id: 'org-1' } });
    const callsChain = createChainMock({ data: [], count: 0, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      return callsChain;
    });

    await getCalls({ important_only: true });

    const eqCalls = callsChain.eq!.mock.calls;
    expect(eqCalls).toContainEqual(['is_important', true]);
  });

  it('should return error for invalid filters', async () => {
    const result = await getCalls({ page: -1 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Filtros inválidos');
    }
  });
});
