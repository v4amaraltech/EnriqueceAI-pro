import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { CockpitViewer } from '../types';

import { fetchNextCallCard } from './next-call-card.service';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));

type Result = { data: unknown; error?: { message: string } | null; count?: number | null };
interface Call {
  table: string;
  calls: Array<[string, unknown[]]>;
}

function makeClient(results: Record<string, Result>) {
  const log: Call[] = [];
  const client = {
    from: vi.fn((table: string) => {
      const call: Call = { table, calls: [] };
      log.push(call);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'in', 'not', 'or', 'order', 'range', 'limit', 'gte']) {
        b[m] = vi.fn((...args: unknown[]) => {
          call.calls.push([m, args]);
          return b;
        });
      }
      const resolve = () => ({ error: null, count: null, ...(results[table] ?? { data: null }) });
      b.maybeSingle = vi.fn(async () => resolve());
      b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, ko);
      return b;
    }),
  };
  return { client, log };
}

const viewer = (over: Partial<CockpitViewer> = {}): CockpitViewer => ({
  viewerId: 'u1',
  orgId: 'org-1',
  isManager: false,
  targetUserId: 'u1',
  targetName: 'U',
  sdrOptions: [],
  ...over,
});

const fullLead = (over: Record<string, unknown> = {}) => ({
  id: 'lead-1',
  assigned_to: 'u1',
  closer_id: null,
  nome_fantasia: 'Acme',
  razao_social: null,
  cnpj: null,
  segmento: 'Software',
  porte: null,
  status: 'contacted',
  first_name: 'Ana',
  last_name: null,
  job_title: 'Diretora',
  email: null,
  telefone: '11999990000',
  socios: [],
  fit_score: null,
  engagement_score: null,
  meeting_no_show_at: null,
  ...over,
});

/** app_flags sensivel a chave: so a call_cockpit_v1 vem ligada, as demais (ex.: call_priority_v2) desligadas. */
function flagsClient(cockpitOn: boolean) {
  const client = {
    from: vi.fn(() => {
      let key = '';
      const b: Record<string, unknown> = {};
      b.select = vi.fn(() => b);
      b.eq = vi.fn((_col: string, value: string) => {
        key = value;
        return b;
      });
      b.limit = vi.fn(async () => ({ data: [{ enabled: key === 'call_cockpit_v1' ? cockpitOn : false }], error: null }));
      return b;
    }),
  };
  return client;
}

function setup(opts: { flag?: boolean; candidates?: unknown[]; holds?: unknown[]; lead?: unknown }) {
  vi.mocked(createServiceRoleClient).mockReturnValue(flagsClient(opts.flag ?? true) as never);
  const server = makeClient({
    leads: { data: opts.candidates ?? [] },
    contact_holds: { data: opts.holds ?? [] },
    interactions: { data: [] },
    calls: { data: [] },
  });
  // Primeira consulta de `leads` traz candidatos; a do contexto usa maybeSingle.
  const origFrom = server.client.from;
  server.client.from = vi.fn((t: string) => {
    const b = origFrom(t) as Record<string, unknown>;
    if (t === 'leads') b.maybeSingle = vi.fn(async () => ({ data: opts.lead ?? null, error: null }));
    return b;
  });
  vi.mocked(createServerSupabaseClient).mockResolvedValue(server.client as never);
  return server;
}

describe('fetchNextCallCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flag desligada: não consulta leads', async () => {
    const server = setup({ flag: false });
    expect(await fetchNextCallCard({ viewer: viewer() })).toEqual({ status: 'disabled' });
    expect(server.client.from).not.toHaveBeenCalled();
  });

  it('SDR: carteira filtrada por assigned_to ou closer_id do usuário exibido, na própria org', async () => {
    const server = setup({ candidates: [] });
    expect(await fetchNextCallCard({ viewer: viewer() })).toEqual({ status: 'empty' });
    const leads = server.log.find((l) => l.table === 'leads')!;
    expect(leads.calls).toContainEqual(['eq', ['org_id', 'org-1']]);
    expect(leads.calls).toContainEqual(['or', ['assigned_to.eq.u1,closer_id.eq.u1']]);
  });

  it('closer: usa o id do closer como alvo da carteira', async () => {
    const server = setup({ candidates: [] });
    await fetchNextCallCard({ viewer: viewer({ viewerId: 'closer-9', targetUserId: 'closer-9' }) });
    const leads = server.log.find((l) => l.table === 'leads')!;
    expect(leads.calls).toContainEqual(['or', ['assigned_to.eq.closer-9,closer_id.eq.closer-9']]);
  });

  it('monta cartão com contexto e abordagem v0', async () => {
    setup({
      candidates: [{ id: 'lead-1', updated_at: '2026-11-06T00:00:00Z', meeting_no_show_at: null, telefone: '11999990000' }],
      lead: fullLead(),
    });
    const r = await fetchNextCallCard({ viewer: viewer(), now: new Date('2026-11-07T12:00:00Z') });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.data.context.leadId).toBe('lead-1');
    expect(r.data.context.objections).toBeNull();
    expect(r.data.approach.version).toBe('v0');
  });

  it('lead com bloqueio total é excluído', async () => {
    setup({
      candidates: [{ id: 'lead-1', updated_at: '2026-11-06T00:00:00Z', meeting_no_show_at: null, telefone: '11999990000' }],
      holds: [{ lead_id: 'lead-1' }],
      lead: fullLead(),
    });
    expect(await fetchNextCallCard({ viewer: viewer() })).toEqual({ status: 'empty' });
  });

  it('lead fora da carteira (permissão do contexto) não vira cartão', async () => {
    setup({
      candidates: [{ id: 'lead-1', updated_at: '2026-11-06T00:00:00Z', meeting_no_show_at: null, telefone: '11999990000' }],
      lead: fullLead({ assigned_to: 'outro', closer_id: 'outro' }),
    });
    expect(await fetchNextCallCard({ viewer: viewer() })).toEqual({ status: 'empty' });
  });

  it('pós-ligação pendente não trava a próxima: o lead já trabalhado é pulado e o seguinte aparece', async () => {
    const server = setup({
      candidates: [
        { id: 'lead-1', updated_at: '2026-11-06T10:00:00Z', meeting_no_show_at: null, telefone: '11999990000' },
        { id: 'lead-2', updated_at: '2026-11-05T10:00:00Z', meeting_no_show_at: null, telefone: '11988880000' },
      ],
      lead: fullLead({ id: 'lead-2' }),
    });
    const r = await fetchNextCallCard({ viewer: viewer(), now: new Date('2026-11-07T12:00:00Z'), excludeLeadIds: ['lead-1'] });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.data.context.leadId).toBe('lead-2');
    // A escolha vem só de leads, bloqueios e interações: resumo/transcrição pendentes não entram.
    expect(server.log.find((l) => l.table === 'leads')).toBeTruthy();
  });

  it('erro ao ler bloqueios falha fechado', async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(flagsClient(true) as never);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeClient({
        leads: { data: [{ id: 'l', updated_at: '2026-11-06T00:00:00Z', meeting_no_show_at: null, telefone: '1199' }] },
        contact_holds: { data: null, error: { message: 'boom' } },
        interactions: { data: [] },
      }).client as never,
    );
    const r = await fetchNextCallCard({ viewer: viewer() });
    expect(r.status).toBe('error');
  });
});
