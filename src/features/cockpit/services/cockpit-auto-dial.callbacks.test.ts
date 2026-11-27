import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CockpitViewer } from '../types';

import { makeAutoDialClient, type AutoDialDb, type Row } from './auto-dial.testkit';
import { checkDialGate, pickAutoDialLead } from './cockpit-auto-dial.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('./cockpit-auto-dial-flag', () => ({ isCockpitAutoDialEnabled: vi.fn(), isCockpitAutoDialLive: vi.fn() }));

import { isCockpitAutoDialEnabled, isCockpitAutoDialLive } from './cockpit-auto-dial-flag';

/** Sexta 13/11/2026 12:00 BRT. */
const NOW = new Date('2026-11-13T15:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const ORG = 'org-1';
const ME = 'user-1';
const viewer: CockpitViewer = { viewerId: ME, orgId: ORG, isManager: false, targetUserId: ME, targetName: 'U', sdrOptions: [] };

const rpcRow = (id: string, over: Row = {}): Row => ({
  lead_id: id, updated_at: '2026-11-06T00:00:00Z', maybe_hot: false, next_step_due: null, attempts_recent: 0, attempts_window: 0,
  calls_today: 0, last_call_at: null, over_attempts: false, cold_rank: null, ...over,
});
const callback = (leadId: string, scheduledMinAgo: number, over: Row = {}): Row => ({
  id: `sa-${leadId}`, org_id: ORG, lead_id: leadId, channel: 'phone', kind: 'return', status: 'pending', scheduled_at: ago(scheduledMinAgo), ...over,
});
const call = (over: Row = {}): Row => ({
  id: `c-${Math.random()}`, org_id: ORG, user_id: ME, lead_id: 'A', created_at: ago(300), started_at: ago(300), answered_at: null,
  duration_seconds: 0, sdr_disposition: null, metadata: {}, ...over,
});
const lead = (id: string): Row => ({ id, org_id: ORG, assigned_to: ME, closer_id: null, deleted_at: null, status: 'contacted', telefone: '11999990000' });

let db: AutoDialDb;
function setup(rpcData: Row[], tables: Record<string, Row[]> = {}) {
  db = {
    tables: { calls: [], contact_holds: [], interactions: [], leads: [lead('A')], custom_fields: [], decision_events: [], scheduled_activities: [], ...tables },
    failReads: new Set(),
    reads: [],
    writes: [],
    rpc: vi.fn(async () => ({ data: rpcData, error: null })),
  };
  return makeAutoDialClient(db) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(true);
  vi.mocked(isCockpitAutoDialLive).mockResolvedValue(false);
});

describe('retornos no topo da fila (FR-23, A-D2)', () => {
  const rows = [rpcRow('A', { cold_rank: 1 }), rpcRow('B', { cold_rank: 2 }), rpcRow('H', { maybe_hot: true, cold_rank: 9 })];

  it('retorno vencido vai ao TOPO, antes do quente e do frio; o mais antigo primeiro', async () => {
    const client = setup(rows, {
      interactions: [{ id: 'i1', org_id: ORG, lead_id: 'H', channel: 'email', type: 'replied', created_at: ago(60) }],
      scheduled_activities: [callback('B', 30), callback('A', 90)],
    });
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ kind: 'picked', leadId: 'A', tier: 'hot', callback: true });
    const only = setup(rows, { scheduled_activities: [callback('B', 30)] });
    expect(await pickAutoDialLead({ viewer, now: NOW, client: only })).toMatchObject({ leadId: 'B', callback: true });
  });

  it('fura o intervalo de 1 h (ligado há 10 min, mas o retorno venceu depois)', async () => {
    const client = setup([rpcRow('A', { cold_rank: 1, calls_today: 1, last_call_at: ago(10) }), rpcRow('B', { cold_rank: 2 })], {
      calls: [call({ lead_id: 'A', created_at: ago(10), started_at: ago(10) }), call({ lead_id: 'A', created_at: ago(200), started_at: ago(200) })],
      scheduled_activities: [callback('A', 5)],
    });
    // a ligação de 10 min atrás veio ANTES da hora marcada (5 min atrás): não consome o retorno
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ leadId: 'A', callback: true });
  });

  it('fura "conversa hoje" (já conversou, pediu retorno para mais tarde)', async () => {
    const client = setup([rpcRow('A', { cold_rank: 1, calls_today: 1, last_call_at: ago(200) }), rpcRow('B', { cold_rank: 2 })], {
      calls: [call({ lead_id: 'A', created_at: ago(200), started_at: ago(200), answered_at: ago(199), duration_seconds: 120, sdr_disposition: 'callback_requested' })],
      scheduled_activities: [callback('A', 30)],
    });
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ leadId: 'A', callback: true });
  });

  it('sem retorno, o mesmo lead continua fora (conversa hoje) — prova de que foi o retorno que o liberou', async () => {
    const client = setup([rpcRow('A', { cold_rank: 1, calls_today: 1, last_call_at: ago(200) }), rpcRow('B', { cold_rank: 2 })], {
      calls: [call({ lead_id: 'A', created_at: ago(200), started_at: ago(200), answered_at: ago(199), duration_seconds: 120, sdr_disposition: 'callback_requested' })],
    });
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ leadId: 'B' });
  });

  it('retorno CONSUMIDO por uma ligação depois da hora marcada volta às regras normais (o intervalo vale de novo)', async () => {
    const client = setup([rpcRow('A', { cold_rank: 1, calls_today: 1, last_call_at: ago(10) }), rpcRow('B', { cold_rank: 2 })], {
      calls: [call({ lead_id: 'A', created_at: ago(10), started_at: ago(10) })],
      scheduled_activities: [callback('A', 40)], // marcado há 40 min; ligação há 10 min já o atendeu
    });
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ leadId: 'B' });
    expect((await pickAutoDialLead({ viewer, now: NOW, client })).kind).toBe('picked');
  });

  it('retorno futuro, de outro canal/tipo ou já concluído NÃO sobe', async () => {
    const client = setup(rows, {
      scheduled_activities: [
        { ...callback('B', -30) }, // daqui a 30 min
        callback('A', 30, { channel: 'whatsapp' }),
        callback('A', 30, { kind: 'limbo_followup' }),
        callback('A', 30, { status: 'completed' }),
      ],
    });
    const r = await pickAutoDialLead({ viewer, now: NOW, client });
    expect(r).toMatchObject({ kind: 'picked', leadId: 'A' });
    expect(r).not.toHaveProperty('callback'); // veio pela fila normal, não pelo retorno
  });

  it('continua respeitando bloqueio (prospeccao/total), as 3 tentativas e a lista de excluídos', async () => {
    const held = setup(rows, { contact_holds: [{ org_id: ORG, lead_id: 'A', tipo: 'prospeccao' }], scheduled_activities: [callback('A', 30)] });
    expect(await pickAutoDialLead({ viewer, now: NOW, client: held })).toMatchObject({ leadId: 'B' });
    const exhausted = setup([rpcRow('A', { cold_rank: 1, calls_today: 3, last_call_at: ago(300) }), rpcRow('B', { cold_rank: 2 })], { scheduled_activities: [callback('A', 30)] });
    expect(await pickAutoDialLead({ viewer, now: NOW, client: exhausted })).toMatchObject({ leadId: 'B' });
    // excluído da sessão: a RPC já não o devolve
    const excluded = setup([rpcRow('B', { cold_rank: 2 })], { scheduled_activities: [callback('A', 30)] });
    expect(await pickAutoDialLead({ viewer, now: NOW, client: excluded, excludeLeadIds: ['A'] })).toMatchObject({ leadId: 'B' });
  });

  it('lead fora da carteira (a RPC não devolve) não é escolhido, mesmo com retorno', async () => {
    const client = setup([rpcRow('B', { cold_rank: 2 })], { scheduled_activities: [callback('Z', 30)] });
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ leadId: 'B' });
  });

  it('simulado: as tentativas simuladas contam (3 simuladas esgotam, até com retorno)', async () => {
    const client = setup([rpcRow('A', { cold_rank: 1 }), rpcRow('B', { cold_rank: 2 })], { scheduled_activities: [callback('A', 30)] });
    expect(await pickAutoDialLead({ viewer, now: NOW, client, simulatedAttempts: { A: [ago(400), ago(300), ago(200)] } })).toMatchObject({ leadId: 'B' });
  });

  it('falha fechada: erro ao ler os retornos ou as ligações = erro (não escolhe)', async () => {
    const client = setup(rows, { scheduled_activities: [callback('A', 30)] });
    db.failReads.add('scheduled_activities');
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toEqual({ kind: 'error' });
    const c2 = setup(rows, { scheduled_activities: [callback('A', 30)] });
    // a leitura de calls (consumo do retorno) também falha fechado
    db.failReads.add('calls');
    expect(await pickAutoDialLead({ viewer, now: NOW, client: c2 })).toEqual({ kind: 'error' });
  });

  it('toda leitura leva org_id e nada é escrito', async () => {
    const client = setup(rows, { scheduled_activities: [callback('A', 30)] });
    await pickAutoDialLead({ viewer, now: NOW, client });
    for (const r of db.reads.filter((x) => x.table !== 'business_holidays')) expect(r.eq.org_id, r.table).toBe(ORG); // business_holidays é global
    expect(db.writes).toEqual([]);
  });
});

describe('portão com retorno vencido', () => {
  const gate = (client: never) => checkDialGate({ orgId: ORG, userId: ME, leadId: 'A', now: NOW, client });

  it('fura o intervalo e a "conversa hoje"', async () => {
    const recent = setup([], { calls: [call({ created_at: ago(10), started_at: ago(10) })] });
    expect(await gate(recent)).toEqual({ ok: false, code: 'gap' });
    const withCb = setup([], { calls: [call({ created_at: ago(200), started_at: ago(200), answered_at: ago(199), duration_seconds: 90 })], scheduled_activities: [callback('A', 30)] });
    expect(await gate(withCb)).toMatchObject({ ok: true, attemptNo: 2 });
    const gapCb = setup([], { calls: [call({ created_at: ago(40), started_at: ago(40) })], scheduled_activities: [callback('A', 30)] }); // ligação ANTES da hora marcada não consome
    expect(await gate(gapCb)).toMatchObject({ ok: true, attemptNo: 2 });
  });

  it('NÃO fura bloqueio nem as 3 tentativas nem a janela', async () => {
    expect(await gate(setup([], { contact_holds: [{ org_id: ORG, lead_id: 'A', tipo: 'prospeccao' }], scheduled_activities: [callback('A', 30)] }))).toEqual({ ok: false, code: 'held' });
    const three = [1, 2, 3].map((n) => call({ id: `x${n}`, created_at: ago(400 - n * 100), started_at: ago(400 - n * 100) }));
    expect(await gate(setup([], { calls: three, scheduled_activities: [callback('A', 30)] }))).toEqual({ ok: false, code: 'attempts' });
    const night = checkDialGate({ orgId: ORG, userId: ME, leadId: 'A', now: new Date('2026-11-13T23:00:00Z'), client: setup([], { scheduled_activities: [callback('A', 30)] }) });
    expect(await night).toEqual({ ok: false, code: 'outside_hours' });
  });

  it('retorno consumido não fura mais', async () => {
    const client = setup([], { calls: [call({ created_at: ago(10), started_at: ago(10) })], scheduled_activities: [callback('A', 40)] });
    expect(await gate(client)).toEqual({ ok: false, code: 'gap' });
  });

  it('erro ao ler os retornos = não disca', async () => {
    const client = setup([], { scheduled_activities: [callback('A', 30)] });
    db.failReads.add('scheduled_activities');
    expect(await gate(client)).toEqual({ ok: false, code: 'error' });
  });
});

describe('retorno marcado para depois fica fora da fila normal', () => {
  const later = (leadId: string, over: Row = {}): Row => callback(leadId, -60, { id: `fut-${leadId}`, ...over });
  const rows = [rpcRow('A', { cold_rank: 1 }), rpcRow('B', { cold_rank: 2 })];
  const gate = (client: never) => checkDialGate({ orgId: ORG, userId: ME, leadId: 'A', now: NOW, client });

  it('a escolha pula o lead e o portão recusa', async () => {
    expect(await pickAutoDialLead({ viewer, now: NOW, client: setup(rows, { scheduled_activities: [later('A')] }) })).toMatchObject({ leadId: 'B' });
    expect(await gate(setup(rows, { scheduled_activities: [later('A')] }))).toEqual({ ok: false, code: 'return_scheduled' });
    expect(db.reads.filter((r) => r.table === 'scheduled_activities').every((r) => r.eq.org_id === ORG)).toBe(true);
  });

  it('um vencido ainda não atendido continua valendo, mesmo com outro futuro', async () => {
    const tables = { scheduled_activities: [later('A'), callback('A', 30)] };
    expect(await pickAutoDialLead({ viewer, now: NOW, client: setup(rows, tables) })).toMatchObject({ leadId: 'A', callback: true });
    expect(await gate(setup(rows, tables))).toMatchObject({ ok: true });
  });

  it.each([
    ['de outra org', { org_id: 'outra' }],
    ['de outro canal', { channel: 'email' }],
    ['de outro tipo', { kind: 'limbo_followup' }],
    ['já concluído', { status: 'completed' }],
  ])('futuro %s não segura o lead', async (_n, over) => {
    expect(await pickAutoDialLead({ viewer, now: NOW, client: setup(rows, { scheduled_activities: [later('A', over)] }) })).toMatchObject({ leadId: 'A' });
    expect(await gate(setup(rows, { scheduled_activities: [later('A', over)] }))).toMatchObject({ ok: true });
  });

  it('erro ao ler os retornos: não escolhe e não disca', async () => {
    const client = setup(rows);
    db.failReads.add('scheduled_activities');
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toEqual({ kind: 'error' });
    expect(await gate(client)).toEqual({ ok: false, code: 'error' });
  });
});
