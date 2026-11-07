import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { CockpitViewer } from '../types';

import { canViewLead, clampPagination, fetchCallContext } from './call-context.service';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));

type Result = { data: unknown; error?: { message: string } | null; count?: number | null };

interface Call {
  table: string;
  filters: Array<[string, unknown]>;
  range?: [number, number];
  limit?: number;
}

/** Builder encadeável: registra filtros e resolve por tabela via `results`. */
function makeClient(results: Record<string, Result | ((c: Call) => Result)>) {
  const calls: Call[] = [];
  const client = {
    from: vi.fn((table: string) => {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const resolve = () => {
        const r = results[table];
        const res = typeof r === 'function' ? r(call) : r;
        return { error: null, count: null, ...(res ?? { data: null }) };
      };
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'order', 'is', 'in']) b[m] = vi.fn(() => b);
      b.eq = vi.fn((col: string, v: unknown) => {
        call.filters.push([col, v]);
        return b;
      });
      b.range = vi.fn((a: number, z: number) => {
        call.range = [a, z];
        return b;
      });
      b.limit = vi.fn((n: number) => {
        call.limit = n;
        return b;
      });
      b.maybeSingle = vi.fn(async () => resolve());
      b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, ko);
      return b;
    }),
  };
  return { client, calls };
}

const lead = {
  id: 'lead-1',
  assigned_to: 'sdr-a',
  closer_id: 'closer-1',
  nome_fantasia: 'Acme',
  razao_social: null,
  cnpj: '11222333000181',
  segmento: 'Software',
  porte: 'ME',
  status: 'contacted',
  first_name: 'Ana',
  last_name: 'Souza',
  job_title: 'Diretora',
  email: 'ana@acme.test',
  telefone: '11999990000',
  socios: [{ nome: 'Beto' }, 'Caio', { nome: 'Dani' }, { nome: 'Edu' }],
  fit_score: 80,
  engagement_score: 40,
  meeting_no_show_at: null,
};

const viewer = (over: Partial<CockpitViewer> = {}): CockpitViewer => ({
  viewerId: 'sdr-a',
  orgId: 'org-1',
  isManager: false,
  targetUserId: 'sdr-a',
  targetName: 'A',
  sdrOptions: [],
  ...over,
});

function setup(opts: { flag: boolean | 'error'; tables?: Record<string, Result | ((c: Call) => Result)> }) {
  const flagClient =
    opts.flag === 'error'
      ? null
      : makeClient({ app_flags: { data: [{ enabled: opts.flag }] } }).client;
  if (flagClient) vi.mocked(createServiceRoleClient).mockReturnValue(flagClient as never);
  else vi.mocked(createServiceRoleClient).mockImplementation(() => { throw new Error('sem env'); });
  const data = makeClient({ leads: { data: lead }, interactions: { data: [], count: 0 }, calls: { data: [], count: 0 }, ...opts.tables });
  vi.mocked(createServerSupabaseClient).mockResolvedValue(data.client as never);
  return data;
}

beforeEach(() => vi.clearAllMocks());

describe('flag call_cockpit_v1', () => {
  it('desligada: retorna disabled e não consulta nenhuma tabela de dados', async () => {
    const { client } = setup({ flag: false });
    const r = await fetchCallContext({ viewer: viewer(), leadId: 'lead-1' });
    expect(r).toEqual({ status: 'disabled' });
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('erro ao ler a flag conta como desligada', async () => {
    setup({ flag: 'error' });
    expect(await fetchCallContext({ viewer: viewer(), leadId: 'lead-1' })).toEqual({ status: 'disabled' });
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });
});

describe('isolamento por organização', () => {
  it('filtra lead, interações e ligações pela org do viewer', async () => {
    const { calls } = setup({ flag: true });
    await fetchCallContext({ viewer: viewer({ orgId: 'org-9' }), leadId: 'lead-1' });
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) expect(c.filters).toContainEqual(['org_id', 'org-9']);
  });

  it('lead de outra org (RLS/filtro não devolve linha) vira not_found', async () => {
    setup({ flag: true, tables: { leads: { data: null } } });
    expect(await fetchCallContext({ viewer: viewer(), leadId: 'lead-outra-org' })).toEqual({ status: 'not_found' });
  });
});

describe('permissão do viewer', () => {
  it('SDR dono da carteira lê', async () => {
    setup({ flag: true });
    expect((await fetchCallContext({ viewer: viewer(), leadId: 'lead-1' })).status).toBe('ok');
  });

  it('closer da carteira lê', async () => {
    setup({ flag: true });
    expect((await fetchCallContext({ viewer: viewer({ viewerId: 'closer-1' }), leadId: 'lead-1' })).status).toBe('ok');
  });

  it('SDR de outra carteira recebe not_found e nenhuma interação/ligação é consultada', async () => {
    const { calls } = setup({ flag: true });
    const r = await fetchCallContext({ viewer: viewer({ viewerId: 'sdr-b' }), leadId: 'lead-1' });
    expect(r).toEqual({ status: 'not_found' });
    expect(calls.map((c) => c.table)).toEqual(['leads']);
  });

  it('gestor lê qualquer lead da org', async () => {
    setup({ flag: true });
    expect((await fetchCallContext({ viewer: viewer({ viewerId: 'mgr', isManager: true }), leadId: 'lead-1' })).status).toBe('ok');
  });

  it('canViewLead', () => {
    expect(canViewLead({ viewerId: 'x', isManager: false }, { assigned_to: null, closer_id: null })).toBe(false);
  });
});

describe('dados ausentes', () => {
  it('lead sem histórico marca ausências de forma explícita', async () => {
    setup({
      flag: true,
      tables: {
        leads: { data: { ...lead, first_name: null, last_name: null, email: null, telefone: null, fit_score: null, engagement_score: null } },
      },
    });
    const r = await fetchCallContext({ viewer: viewer(), leadId: 'lead-1' });
    if (r.status !== 'ok') throw new Error('esperava ok');
    expect(r.data.missing).toEqual(
      expect.arrayContaining(['objections', 'contact', 'signals', 'interactions', 'calls', 'fit', 'engagement']),
    );
    expect(r.data.objections).toBeNull();
    expect(r.data.whyNow.code).toBe('no_signal');
    expect(r.data.interactions).toEqual([]);
    expect(r.data.calls).toEqual([]);
  });

  it('erro nas consultas secundárias não derruba o contexto', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setup({ flag: true, tables: { interactions: { data: null, error: { message: 'x' } }, calls: { data: null, error: { message: 'y' } } } });
    expect((await fetchCallContext({ viewer: viewer(), leadId: 'lead-1' })).status).toBe('ok');
  });

  it('erro na consulta do lead devolve error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setup({ flag: true, tables: { leads: { data: null, error: { message: 'boom' } } } });
    expect((await fetchCallContext({ viewer: viewer(), leadId: 'lead-1' })).status).toBe('error');
  });
});

describe('consolidação', () => {
  it('monta empresa, decisor, sinais, ligações e motivo', async () => {
    const now = new Date('2026-11-07T12:00:00Z');
    setup({
      flag: true,
      tables: {
        interactions: (c) =>
          c.range
            ? { data: [{ id: 'i1', channel: 'email', type: 'sent', created_at: '2026-11-06T10:00:00Z', message_content: 'x'.repeat(500), ai_generated: true }], count: 1 }
            : { data: [{ channel: 'whatsapp', type: 'replied', created_at: '2026-11-06T11:00:00Z' }] },
        calls: {
          data: [
            {
              id: 'c1',
              started_at: '2026-11-05T10:00:00Z',
              duration_seconds: 120,
              connected: true,
              status: 'significant',
              sdr_outcome: null,
              sdr_disposition: null,
              notes: 'nota do SDR',
              metadata: { ai_outcome: { status: 'done', disposition: 'callback_requested', summary: 'Pediu retorno', callback_at: '2026-11-08T12:00:00Z' } },
            },
          ],
          count: 1,
        },
      },
    });
    const r = await fetchCallContext({ viewer: viewer(), leadId: 'lead-1', now });
    if (r.status !== 'ok') throw new Error('esperava ok');
    expect(r.data.company.name).toBe('Acme');
    expect(r.data.decisionMaker.partners).toEqual(['Beto', 'Caio', 'Dani']);
    expect(r.data.interactions[0]?.excerpt).toHaveLength(280);
    expect(r.data.signals.map((s) => [s.kind, s.source])).toEqual([
      ['callback_requested', 'phone'],
      ['replied', 'whatsapp'],
    ]);
    expect(r.data.whyNow.code).toBe('replied');
    expect(r.data.calls[0]).toMatchObject({ outcome: 'callback_requested', summary: 'Pediu retorno' });
    expect(r.data.scores).toEqual({ fit: 80, engagement: 40 });
    expect(r.data.missing).toEqual(['objections']);
  });
});

describe('paginação', () => {
  it('clampPagination limita perPage e normaliza page', () => {
    expect(clampPagination(0, 999)).toEqual({ page: 1, perPage: 20 });
    expect(clampPagination(3, 7)).toEqual({ page: 3, perPage: 7 });
    expect(clampPagination(undefined, undefined)).toEqual({ page: 1, perPage: 5 });
    expect(clampPagination(Number.NaN, -4)).toEqual({ page: 1, perPage: 5 });
  });

  it('aplica range e limita sinais; hasMore usa o total', async () => {
    const { calls } = setup({
      flag: true,
      tables: { interactions: (c) => (c.range ? { data: [], count: 100 } : { data: [] }), calls: { data: [], count: 0 } },
    });
    const r = await fetchCallContext({ viewer: viewer(), leadId: 'lead-1', page: 2, perPage: 1000 });
    if (r.status !== 'ok') throw new Error('esperava ok');
    const ranged = calls.filter((c) => c.range);
    expect(ranged.map((c) => c.range)).toEqual([[20, 39], [20, 39]]);
    expect(calls.some((c) => c.limit === 10)).toBe(true);
    expect(r.data.interactionsPage).toEqual({ page: 2, perPage: 20, total: 100, hasMore: true });
    expect(r.data.callsPage.hasMore).toBe(false);
  });
});
