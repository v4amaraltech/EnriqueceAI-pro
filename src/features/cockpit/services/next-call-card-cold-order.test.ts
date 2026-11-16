import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { makeDb, makeFakeClient, type FakeDb, type Row } from '@/features/contact-engine/services/call-priority.testkit';

import type { CockpitViewer } from '../types';

import { fetchNextCallCard } from './next-call-card.service';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));

const NOW = new Date('2026-11-15T12:00:00Z');
const viewer: CockpitViewer = { viewerId: 'u1', orgId: 'org-1', isManager: false, targetUserId: 'u1', targetName: 'U', sdrOptions: [] };

const lead = (id: string, over: Row = {}): Row => ({
  id,
  org_id: 'org-1',
  assigned_to: 'u1',
  closer_id: null,
  deleted_at: null,
  nome_fantasia: `Empresa ${id}`,
  razao_social: null,
  cnpj: null,
  segmento: null,
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
  updated_at: '2026-11-06T00:00:00Z',
  custom_field_values: {},
  ...over,
});

const rpcRow = (id: string, over: Row = {}): Row => ({
  lead_id: id,
  updated_at: '2026-11-06T00:00:00Z',
  maybe_hot: false,
  next_step_due: null,
  attempts_recent: 0,
  attempts_window: 0,
  calls_today: 0,
  last_call_at: null,
  over_attempts: false,
  cold_rank: null,
  ...over,
});

let rpc: ReturnType<typeof vi.fn>;

function seed(rows: Row[] | { error: string }, opts: { v1Leads?: boolean } = {}): FakeDb {
  const db = makeDb({
    app_flags: [
      { key: 'call_cockpit_v1', enabled: true },
      { key: 'call_priority_v2', enabled: false },
      { key: 'cockpit_cold_order', enabled: true },
    ],
    leads: opts.v1Leads === false ? [] : [lead('lead-v1'), lead('cold-a'), lead('cold-b'), lead('hot-1')],
    contact_holds: [],
    interactions: [{ id: 'i1', org_id: 'org-1', lead_id: 'lead-v1', channel: 'email', type: 'clicked', created_at: '2026-11-14T10:00:00Z' }],
    calls: [],
    custom_fields: [],
    decision_events: [],
  });
  rpc = vi.fn(async () => ('error' in rows ? { data: null, error: { message: rows.error } } : { data: rows, error: null }));
  const client = { ...makeFakeClient(db), rpc } as never;
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client);
  vi.mocked(createServiceRoleClient).mockReturnValue(client);
  return db;
}

const setFlag = (db: FakeDb, key: string, enabled: boolean) => {
  db.tables.app_flags!.find((f) => f.key === key)!.enabled = enabled;
};

async function card() {
  const r = await fetchNextCallCard({ viewer, now: NOW });
  return r;
}

beforeEach(() => vi.clearAllMocks());

describe('fetchNextCallCard com cockpit_cold_order', () => {
  it('desligada: não chama a RPC e mantém a escolha de antes', async () => {
    const db = seed([rpcRow('cold-a', { cold_rank: 1 })]);
    setFlag(db, 'cockpit_cold_order', false);
    const r = await card();
    expect(r.status === 'ok' && r.data.context.leadId).toBe('lead-v1');
    expect(r.status === 'ok' && r.data.priority).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ligada, sem quente: menor cold_rank da carteira inteira, com rótulo de frio', async () => {
    seed([rpcRow('cold-b', { cold_rank: 2 }), rpcRow('cold-a', { cold_rank: 1 })]);
    const r = await card();
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.data.context.leadId).toBe('cold-a');
    expect(r.data.priority).toMatchObject({ tier: 'cold', tierLabel: 'Sem leads quentes, mostrando frio' });
  });

  it('ligada, com quente confirmado: ele vem antes dos frios e sem rótulo', async () => {
    const db = seed([rpcRow('cold-a', { cold_rank: 1 }), rpcRow('hot-1', { maybe_hot: true, cold_rank: 9 })]);
    db.tables.interactions!.push({ id: 'ir', org_id: 'org-1', lead_id: 'hot-1', channel: 'email', type: 'replied', created_at: '2026-11-14T08:00:00Z' });
    const r = await card();
    expect(r.status === 'ok' && r.data.context.leadId).toBe('hot-1');
    expect(r.status === 'ok' && r.data.priority).toMatchObject({ tier: 'hot', tierLabel: null });
  });

  it('possível quente sem interesse real volta para a posição de frio', async () => {
    seed([rpcRow('cold-a', { cold_rank: 3 }), rpcRow('cold-b', { maybe_hot: true, cold_rank: 1 })]);
    const r = await card();
    expect(r.status === 'ok' && r.data.context.leadId).toBe('cold-b');
    expect(r.status === 'ok' && r.data.priority?.tier).toBe('cold');
  });

  it('RPC com erro: volta à escolha de antes', async () => {
    seed({ error: 'boom' });
    const r = await card();
    expect(r.status === 'ok' && r.data.context.leadId).toBe('lead-v1');
    expect(r.status === 'ok' && r.data.priority).toBeUndefined();
  });

  it('falha ao ler sinais dos possíveis quentes: volta à escolha de antes', async () => {
    const db = seed([rpcRow('hot-1', { maybe_hot: true, cold_rank: 1 })]);
    db.failReads.add('decision_events');
    const r = await card();
    expect(r.status === 'ok' && r.data.context.leadId).toBe('lead-v1');
  });

  it('excluídos da sessão chegam à RPC e o org_id vai explícito', async () => {
    seed([rpcRow('cold-a', { cold_rank: 1 })]);
    await fetchNextCallCard({ viewer, now: NOW, excludeLeadIds: ['x1', 'x2'] });
    expect(rpc).toHaveBeenCalledWith(
      'cockpit_next_call_candidates',
      expect.objectContaining({ p_org_id: 'org-1', p_target_user_id: 'u1', p_exclude_lead_ids: ['x1', 'x2'], p_now: NOW.toISOString() }),
    );
  });

  it('os 15 mais recentes vazios (v1 sem candidato), mas a carteira tem lead frio: sugere', async () => {
    // O fake ignora `limit`; telefone em branco tira o lead do v1 (filtro em código) sem tirá-lo do contexto.
    const db = seed([rpcRow('far-away', { cold_rank: 1 })], { v1Leads: false });
    db.tables.leads!.push(lead('far-away', { telefone: ' ' }));
    const r = await card();
    expect(r.status === 'ok' && r.data.context.leadId).toBe('far-away');
    expect(r.status === 'ok' && r.data.priority?.tier).toBe('cold');
  });

  it('RPC sem ninguém elegível (ex.: todos no teto diário): vazio', async () => {
    seed([], { v1Leads: false });
    expect((await card()).status).toBe('empty');
  });

  it('v1 COM lead e RPC vazia (todos no teto ou sem elegível): status empty, sem cair no v1', async () => {
    seed([]); // v1 tem lead-v1 e outros; a RPC não devolve ninguém
    expect((await card()).status).toBe('empty');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('falha ao gravar a trilha não muda o lead escolhido', async () => {
    const db = seed([rpcRow('cold-b', { cold_rank: 2 }), rpcRow('cold-a', { cold_rank: 1 })]);
    const base = makeFakeClient(db);
    const failing = {
      ...base,
      rpc,
      from(table: string) {
        const b = base.from(table) as Record<string, unknown>;
        if (table === 'decision_events') {
          b.insert = () => {
            throw new Error('falha ao gravar a trilha');
          };
        }
        return b;
      },
    } as never;
    vi.mocked(createServerSupabaseClient).mockResolvedValue(failing);
    vi.mocked(createServiceRoleClient).mockReturnValue(failing);
    const r = await card();
    await Promise.resolve();
    expect(r.status === 'ok' && r.data.context.leadId).toBe('cold-a');
    expect(r.status === 'ok' && r.data.priority?.tier).toBe('cold');
    expect(db.tables.decision_events).toHaveLength(0);
  });

  it('grava a trilha da sugestão também para frio', async () => {
    const db = seed([rpcRow('cold-a', { cold_rank: 1 })]);
    await card();
    await Promise.resolve();
    expect(db.tables.decision_events).toHaveLength(1);
    expect(db.tables.decision_events![0]).toMatchObject({ event_type: 'priority_suggestion', lead_id: 'cold-a', org_id: 'org-1' });
  });
});
