import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeSupabase, makeRows } from '@tests/mocks/postgrest-table';

import { exportCallsCsv } from './export-calls-csv';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

function createChainMock(resolvedValue: unknown = { data: null, error: null }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'eq', 'neq', 'in', 'is', 'not', 'gte', 'lte', 'or', 'order', 'single', 'limit'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Paginação (`fetchAllRows`): devolve a fatia pedida.
  const { data, error } = resolvedValue as { data: unknown; error?: unknown };
  chain.range = vi.fn((from: number, to: number) =>
    Promise.resolve({ data: Array.isArray(data) ? data.slice(from, to + 1) : data, error: error ?? null }),
  );
  chain.then = vi.fn((resolve) => resolve(resolvedValue));
  return chain;
}

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

describe('exportCallsCsv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export CSV with header and data', async () => {
    const memberChain = createChainMock({ data: { org_id: 'org-1' } });
    const callsChain = createChainMock({
      data: [
        {
          id: 'call-1',
          origin: '11999991111',
          destination: '11888882222',
          started_at: '2026-02-21T10:00:00Z',
          duration_seconds: 120,
          status: 'significant',
          type: 'outbound',
          cost: 1.5,
          is_important: true,
          notes: 'Test note',
        },
      ],
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      return callsChain;
    });

    const result = await exportCallsCsv({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.csv).toContain('Status,Tipo,Origem,Destino');
      expect(result.data.csv).toContain('Significativa');
      expect(result.data.csv).toContain('11999991111');
      expect(result.data.csv).toContain('02:00');
      expect(result.data.filename).toMatch(/^ligacoes-\d{4}-\d{2}-\d{2}\.csv$/);
    }
  });

  it('should return empty CSV when no calls', async () => {
    const memberChain = createChainMock({ data: { org_id: 'org-1' } });
    const callsChain = createChainMock({ data: [], error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      return callsChain;
    });

    const result = await exportCallsCsv({});

    expect(result.success).toBe(true);
    if (result.success) {
      const lines = result.data.csv.split('\n');
      expect(lines).toHaveLength(1); // Header only
    }
  });

  it('should return error when org not found', async () => {
    const memberChain = createChainMock({ data: null });
    mockFrom.mockReturnValue(memberChain);

    const result = await exportCallsCsv({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Organização não encontrada');
    }
  });

  it('should return error on db failure', async () => {
    const memberChain = createChainMock({ data: { org_id: 'org-1' } });
    const callsChain = createChainMock({ data: null, error: { message: 'DB error' } });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      return callsChain;
    });

    const result = await exportCallsCsv({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Erro ao exportar ligações');
    }
  });

  it('exporta TODAS as ligações do filtro, mesmo acima de 5.000 (antes `.limit(5000)`)', async () => {
    const memberChain = createChainMock({ data: { org_id: 'org-1' } });
    const base = Date.parse('2026-08-01T12:00:00Z');
    const fake = createFakeSupabase({
      calls: makeRows(12_000, (i, id) => ({
        id,
        status: 'significant',
        type: 'outbound',
        origin: '1024',
        destination: `dest-${i}`,
        started_at: new Date(base + i * 60_000).toISOString(),
        duration_seconds: 60,
        cost: null,
        is_important: false,
        notes: null,
        provider: i === 11_999 ? 'whatsapp' : null,
      })),
    });
    const fakeFrom = (fake.client as unknown as { from: (t: string) => unknown }).from;

    mockFrom.mockImplementation((table: string) =>
      table === 'organization_members' ? memberChain : fakeFrom(table),
    );

    const result = await exportCallsCsv({});

    expect(result.success).toBe(true);
    if (result.success) {
      const lines = result.data.csv.split('\n');
      expect(lines).toHaveLength(12_001); // cabeçalho + 12.000
      // Mais recente primeiro; WhatsApp vem do `metadata->>provider`.
      expect(lines[1]).toContain('dest-11999,');
      expect(lines[1]).toContain('WhatsApp');
    }
    expect(fake.orders.calls?.every((cols) => cols.at(-1) === 'id')).toBe(true);
  });

  it('should escape CSV fields with commas', async () => {
    const memberChain = createChainMock({ data: { org_id: 'org-1' } });
    const callsChain = createChainMock({
      data: [
        {
          id: 'call-1',
          origin: '11999991111',
          destination: '11888882222',
          started_at: '2026-02-21T10:00:00Z',
          duration_seconds: 60,
          status: 'significant',
          type: 'manual',
          cost: null,
          is_important: false,
          notes: 'Note with, comma',
        },
      ],
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return memberChain;
      return callsChain;
    });

    const result = await exportCallsCsv({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.csv).toContain('"Note with, comma"');
    }
  });
});
