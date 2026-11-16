import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CockpitViewer } from '../types';

import { makeAutoDialClient, type AutoDialDb, type Row } from './auto-dial.testkit';
import { checkDialGate, countMotorCallsToday, pickAutoDialLead } from './cockpit-auto-dial.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('./cockpit-auto-dial-flag', () => ({ isCockpitAutoDialEnabled: vi.fn(), isCockpitAutoDialLive: vi.fn() }));

import { isCockpitAutoDialEnabled, isCockpitAutoDialLive } from './cockpit-auto-dial-flag';

/** Sexta 13/11/2026 12:00 BRT. O dia de Brasília começa em 03:00Z. */
const NOW = new Date('2026-11-13T15:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const ORG = 'org-1';
const ME = 'user-1';
const viewer: CockpitViewer = { viewerId: ME, orgId: ORG, isManager: false, targetUserId: ME, targetName: 'U', sdrOptions: [] };

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
const lead = (id: string, over: Row = {}): Row => ({
  id,
  org_id: ORG,
  assigned_to: ME,
  closer_id: null,
  deleted_at: null,
  status: 'contacted',
  telefone: '11999990000',
  ...over,
});
const call = (over: Row = {}): Row => ({
  id: `c-${Math.random()}`,
  org_id: ORG,
  user_id: ME,
  lead_id: 'A',
  created_at: ago(300),
  started_at: ago(300),
  answered_at: null,
  metadata: {},
  ...over,
});

let db: AutoDialDb;
function setup(rpcData: Row[] | null, tables: Record<string, Row[]> = {}) {
  db = {
    tables: { calls: [], contact_holds: [], interactions: [], leads: [], custom_fields: [], decision_events: [], ...tables },
    failReads: new Set(),
    reads: [],
    writes: [],
    rpc: vi.fn(async () => (rpcData === null ? { data: null, error: { message: 'rpc falhou' } } : { data: rpcData, error: null })),
  };
  return makeAutoDialClient(db) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(true);
  vi.mocked(isCockpitAutoDialLive).mockResolvedValue(false);
});

describe('pickAutoDialLead', () => {
  it('chama a RPC do #641 com os overrides do motor (teto 3, cold_limit 1000) e os excluídos da sessão', async () => {
    const client = setup([rpcRow('A', { cold_rank: 1 })]);
    await pickAutoDialLead({ viewer, now: NOW, excludeLeadIds: ['x1'], client });
    expect(db.rpc).toHaveBeenCalledWith(
      'cockpit_next_call_candidates',
      expect.objectContaining({ p_org_id: ORG, p_target_user_id: ME, p_daily_cap: 3, p_cold_limit: 1000, p_exclude_lead_ids: ['x1'], p_now: NOW.toISOString() }),
    );
  });

  it('sem quente: o menor cold_rank', async () => {
    const client = setup([rpcRow('B', { cold_rank: 2 }), rpcRow('A', { cold_rank: 1 })]);
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ kind: 'picked', leadId: 'A', tier: 'cold' });
  });

  it('quente confirmado vem antes do frio (mesma ordem do #641)', async () => {
    const client = setup([rpcRow('A', { cold_rank: 1 }), rpcRow('H', { maybe_hot: true, cold_rank: 9 })], {
      interactions: [{ id: 'i1', org_id: ORG, lead_id: 'H', channel: 'email', type: 'replied', created_at: ago(60) }],
    });
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ kind: 'picked', leadId: 'H', tier: 'hot' });
  });

  it('possível quente sem interesse real volta à posição de frio', async () => {
    const client = setup([rpcRow('A', { cold_rank: 2 }), rpcRow('M', { maybe_hot: true, cold_rank: 1 })]);
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ kind: 'picked', leadId: 'M', tier: 'cold' });
  });

  it('FR-4: lead com 3 ligações hoje (qualquer origem) não é escolhido, nem se for quente', async () => {
    const client = setup([rpcRow('H', { maybe_hot: true, calls_today: 3, last_call_at: ago(300) }), rpcRow('A', { cold_rank: 1 })], {
      interactions: [{ id: 'i1', org_id: ORG, lead_id: 'H', channel: 'email', type: 'replied', created_at: ago(60) }],
    });
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ leadId: 'A' });
  });

  it('FR-5: ligado há menos de 1 h não é escolhido; há 60 min é', async () => {
    const early = setup([rpcRow('A', { cold_rank: 1, calls_today: 1, last_call_at: ago(59) }), rpcRow('B', { cold_rank: 2 })]);
    expect(await pickAutoDialLead({ viewer, now: NOW, client: early })).toMatchObject({ leadId: 'B' });
    const ok = setup([rpcRow('A', { cold_rank: 1, calls_today: 1, last_call_at: ago(60) }), rpcRow('B', { cold_rank: 2 })]);
    expect(await pickAutoDialLead({ viewer, now: NOW, client: ok })).toMatchObject({ leadId: 'A' });
  });

  it('FR-5: todos esperando o intervalo → waiting com a hora da primeira liberação', async () => {
    const client = setup([
      rpcRow('A', { cold_rank: 1, calls_today: 1, last_call_at: ago(10) }),
      rpcRow('B', { cold_rank: 2, calls_today: 1, last_call_at: ago(40) }),
    ]);
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toEqual({ kind: 'waiting', until: Date.parse(ago(40)) + 3_600_000 });
  });

  it('FR-10: bloqueio prospeccao e total tiram o lead; conversa não', async () => {
    const client = setup([rpcRow('A', { cold_rank: 1 }), rpcRow('B', { cold_rank: 2 }), rpcRow('C', { cold_rank: 3 })], {
      contact_holds: [
        { org_id: ORG, lead_id: 'A', tipo: 'prospeccao' },
        { org_id: ORG, lead_id: 'B', tipo: 'conversa' },
      ],
    });
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ leadId: 'B' });
    const total = setup([rpcRow('A', { cold_rank: 1 }), rpcRow('B', { cold_rank: 2 })], { contact_holds: [{ org_id: ORG, lead_id: 'A', tipo: 'total' }] });
    expect(await pickAutoDialLead({ viewer, now: NOW, client: total })).toMatchObject({ leadId: 'B' });
  });

  it('FR-9b/M-1: conversa real hoje (qualquer origem) sai do dia; conversa de ontem não', async () => {
    const client = setup([rpcRow('A', { cold_rank: 1 }), rpcRow('B', { cold_rank: 2 }), rpcRow('C', { cold_rank: 3 })], {
      calls: [
        call({ lead_id: 'A', user_id: 'outro-sdr', created_at: ago(200), answered_at: ago(199), duration_seconds: 120 }),
        call({ lead_id: 'B', created_at: '2026-11-12T20:00:00Z', answered_at: '2026-11-12T20:00:05Z', duration_seconds: 120 }),
      ],
    });
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ leadId: 'B' });
  });

  it('M-1: caixa postal e atendimento curto VOLTAM à fila (contam como tentativa); só 50 s+ ou desfecho de conversa tira', async () => {
    const rows = [rpcRow('A', { cold_rank: 1, calls_today: 1, last_call_at: ago(120) }), rpcRow('B', { cold_rank: 2 })];
    const voicemail = setup(rows, { calls: [call({ lead_id: 'A', created_at: ago(120), started_at: ago(120), answered_at: ago(119), duration_seconds: 8, sdr_disposition: 'voicemail' })] });
    expect(await pickAutoDialLead({ viewer, now: NOW, client: voicemail })).toMatchObject({ leadId: 'A' });
    const short = setup(rows, { calls: [call({ lead_id: 'A', created_at: ago(120), started_at: ago(120), answered_at: ago(119), duration_seconds: 49 })] });
    expect(await pickAutoDialLead({ viewer, now: NOW, client: short })).toMatchObject({ leadId: 'A' });
    const long = setup(rows, { calls: [call({ lead_id: 'A', created_at: ago(120), started_at: ago(120), answered_at: ago(119), duration_seconds: 50 })] });
    expect(await pickAutoDialLead({ viewer, now: NOW, client: long })).toMatchObject({ leadId: 'B' });
  });

  it('modo simulado: tentativas simuladas contam (3 = fora; recente = espera 1 h)', async () => {
    const rows = [rpcRow('A', { cold_rank: 1 }), rpcRow('B', { cold_rank: 2 })];
    const three = setup(rows);
    expect(
      await pickAutoDialLead({ viewer, now: NOW, client: three, simulatedAttempts: { A: [ago(400), ago(300), ago(200)] } }),
    ).toMatchObject({ leadId: 'B' });
    const recent = setup([rpcRow('A', { cold_rank: 1 })]);
    expect(await pickAutoDialLead({ viewer, now: NOW, client: recent, simulatedAttempts: { A: [ago(5)] } })).toEqual({
      kind: 'waiting',
      until: Date.parse(ago(5)) + 3_600_000,
    });
  });

  it('carteira vazia → empty', async () => {
    expect(await pickAutoDialLead({ viewer, now: NOW, client: setup([]) })).toEqual({ kind: 'empty' });
  });

  describe('falha fechada (NFR-4)', () => {
    it('RPC com erro', async () => {
      expect(await pickAutoDialLead({ viewer, now: NOW, client: setup(null) })).toEqual({ kind: 'error' });
    });
    it('erro ao ler bloqueios', async () => {
      const client = setup([rpcRow('A', { cold_rank: 1 })]);
      db.failReads.add('contact_holds');
      expect(await pickAutoDialLead({ viewer, now: NOW, client })).toEqual({ kind: 'error' });
    });
    it('erro ao ler as ligações atendidas', async () => {
      const client = setup([rpcRow('A', { cold_rank: 1 })]);
      db.failReads.add('calls');
      expect(await pickAutoDialLead({ viewer, now: NOW, client })).toEqual({ kind: 'error' });
    });
    it('erro ao ler os sinais dos quentes', async () => {
      const client = setup([rpcRow('H', { maybe_hot: true, cold_rank: 1 })]);
      db.failReads.add('decision_events');
      expect(await pickAutoDialLead({ viewer, now: NOW, client })).toEqual({ kind: 'error' });
    });
  });

  it('toda leitura direta leva org_id', async () => {
    const client = setup([rpcRow('A', { cold_rank: 1 })]);
    await pickAutoDialLead({ viewer, now: NOW, client });
    for (const r of db.reads.filter((x) => x.table !== 'business_holidays')) expect(r.eq.org_id, r.table).toBe(ORG); // business_holidays é global
  });

  it('nunca escreve no banco', async () => {
    const client = setup([rpcRow('A', { cold_rank: 1 })]);
    await pickAutoDialLead({ viewer, now: NOW, client });
    expect(db.writes).toEqual([]);
  });
});

describe('checkDialGate (travas no servidor)', () => {
  const base = (over: Record<string, Row[]> = {}) =>
    setup([], { leads: [lead('A')], ...over });
  const gate = (client: never, at: Date = NOW) => checkDialGate({ orgId: ORG, userId: ME, leadId: 'A', now: at, client });

  it('tudo livre: devolve o telefone lido NO SERVIDOR e a tentativa', async () => {
    expect(await gate(base())).toEqual({ ok: true, live: false, phone: '11999990000', attemptNo: 1, leadId: 'A' });
  });

  it('live vem das flags lidas no servidor', async () => {
    vi.mocked(isCockpitAutoDialLive).mockResolvedValue(true);
    expect(await gate(base())).toMatchObject({ ok: true, live: true });
  });

  it('flag desligada: recusa sem tocar em calls', async () => {
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(false);
    const client = base();
    expect(await gate(client)).toEqual({ ok: false, code: 'flag_off' });
    expect(db.reads).toEqual([]);
  });

  it('erro ao ler a flag = recusa (falha fechada)', async () => {
    vi.mocked(isCockpitAutoDialEnabled).mockRejectedValue(new Error('x'));
    expect(await gate(base())).toEqual({ ok: false, code: 'error' });
  });

  it.each([
    ['sexta 20:00:00', '2026-11-13T23:00:00Z', 'outside_hours'],
    ['sexta 19:59:59', '2026-11-13T22:59:59Z', 'ok'],
    ['sábado', '2026-11-14T15:00:00Z', 'outside_hours'],
    ['feriado 20/11', '2026-11-20T15:00:00Z', 'holiday'],
  ])('janela: %s', async (_n, iso, expected) => {
    const r = await gate(base(), new Date(iso));
    if (expected === 'ok') expect(r.ok).toBe(true);
    else expect(r).toEqual({ ok: false, code: expected });
  });

  it('teto: conta SÓ as ligações do motor (400 da Execução não bloqueiam; 400 do motor bloqueiam)', async () => {
    const exec = Array.from({ length: 400 }, (_, i) => call({ id: `e${i}`, lead_id: 'Z', started_at: ago(200), metadata: {} }));
    expect((await gate(base({ calls: exec }))).ok).toBe(true);
    const motor = Array.from({ length: 400 }, (_, i) => call({ id: `m${i}`, lead_id: 'Z', started_at: ago(200), metadata: { cockpit_auto_dial: { attempt_no: 1 } } }));
    expect(await gate(base({ calls: motor }))).toEqual({ ok: false, code: 'daily_cap' });
    const motor99 = motor.slice(0, 399);
    expect((await gate(base({ calls: motor99 }))).ok).toBe(true);
  });

  it('teto: ligação do motor de ONTEM ou de outro SDR não conta', async () => {
    const old = Array.from({ length: 400 }, (_, i) => call({ id: `o${i}`, lead_id: 'Z', started_at: '2026-11-12T20:00:00Z', metadata: { cockpit_auto_dial: {} } }));
    const other = Array.from({ length: 400 }, (_, i) => call({ id: `p${i}`, user_id: 'outro', lead_id: 'Z', started_at: ago(100), metadata: { cockpit_auto_dial: {} } }));
    expect((await gate(base({ calls: [...old, ...other] }))).ok).toBe(true);
  });

  it('dono do lead: SDR dono ou closer passam; outro SDR é not_owner', async () => {
    expect((await gate(setup([], { leads: [lead('A', { assigned_to: 'x', closer_id: ME })] }))).ok).toBe(true);
    expect(await gate(setup([], { leads: [lead('A', { assigned_to: 'x', closer_id: null })] }))).toEqual({ ok: false, code: 'not_owner' });
  });

  it('lead de outra org, excluído, inexistente ou arquivado: lead_unavailable', async () => {
    expect(await gate(setup([], { leads: [lead('A', { org_id: 'org-2' })] }))).toEqual({ ok: false, code: 'lead_unavailable' });
    expect(await gate(setup([], { leads: [lead('A', { deleted_at: ago(1) })] }))).toEqual({ ok: false, code: 'lead_unavailable' });
    expect(await gate(setup([], { leads: [] }))).toEqual({ ok: false, code: 'lead_unavailable' });
    expect(await gate(setup([], { leads: [lead('A', { status: 'archived' })] }))).toEqual({ ok: false, code: 'lead_unavailable' });
  });

  it('sem telefone: no_phone', async () => {
    expect(await gate(setup([], { leads: [lead('A', { telefone: '  ' })] }))).toEqual({ ok: false, code: 'no_phone' });
  });

  it('FR-10: bloqueio total e prospeccao recusam (held); conversa não', async () => {
    for (const tipo of ['total', 'prospeccao']) {
      expect(await gate(base({ contact_holds: [{ org_id: ORG, lead_id: 'A', tipo }] }))).toEqual({ ok: false, code: 'held' });
    }
    expect((await gate(base({ contact_holds: [{ org_id: ORG, lead_id: 'A', tipo: 'conversa' }] }))).ok).toBe(true);
  });

  it('FR-4: 3 ligações hoje (qualquer origem) recusam; 2 liberam com attemptNo 3', async () => {
    const three = [call({ created_at: ago(400), user_id: 'x' }), call({ created_at: ago(300) }), call({ created_at: ago(200) })];
    expect(await gate(base({ calls: three }))).toEqual({ ok: false, code: 'attempts' });
    expect(await gate(base({ calls: three.slice(0, 2) }))).toMatchObject({ ok: true, attemptNo: 3 });
  });

  it('FR-5: 59 min recusa (gap); 60 min libera', async () => {
    expect(await gate(base({ calls: [call({ created_at: ago(59), started_at: ago(59) })] }))).toEqual({ ok: false, code: 'gap' });
    expect((await gate(base({ calls: [call({ created_at: ago(60), started_at: ago(60) })] }))).ok).toBe(true);
  });

  it('FR-9b/M-1: conversa real hoje recusa; ligação de ontem não conta', async () => {
    expect(await gate(base({ calls: [call({ created_at: ago(300), answered_at: ago(299), duration_seconds: 90 })] }))).toEqual({ ok: false, code: 'answered_today' });
    expect((await gate(base({ calls: [call({ created_at: '2026-11-12T20:00:00Z', answered_at: '2026-11-12T20:00:05Z', duration_seconds: 90 })] }))).ok).toBe(true);
  });

  it('M-1: caixa postal e atendimento curto NÃO recusam (voltam à fila) e contam como tentativa', async () => {
    const vm = await gate(base({ calls: [call({ created_at: ago(300), started_at: ago(300), answered_at: ago(299), duration_seconds: 6, sdr_disposition: 'voicemail' })] }));
    expect(vm).toMatchObject({ ok: true, attemptNo: 2 });
    const short = await gate(base({ calls: [call({ created_at: ago(300), started_at: ago(300), answered_at: ago(299), duration_seconds: 49 })] }));
    expect(short).toMatchObject({ ok: true, attemptNo: 2 });
    const isConv = await gate(base({ calls: [call({ created_at: ago(300), started_at: ago(300), answered_at: ago(299), duration_seconds: 50 })] }));
    expect(isConv).toEqual({ ok: false, code: 'answered_today' });
  });

  it('M-1: desfecho do SDR sobrepõe a duração (conversa curta marcada pelo SDR sai; 3 caixas postais esgotam as tentativas)', async () => {
    const conv = await gate(base({ calls: [call({ created_at: ago(300), started_at: ago(300), answered_at: ago(299), duration_seconds: 20, sdr_disposition: 'relevant_conversation' })] }));
    expect(conv).toEqual({ ok: false, code: 'answered_today' });
    const three = await gate(base({ calls: [1, 2, 3].map((n) => call({ id: `v${n}`, created_at: ago(400 - n * 70), started_at: ago(400 - n * 70), answered_at: ago(399 - n * 70), duration_seconds: 5, sdr_disposition: 'voicemail' })) }));
    expect(three).toEqual({ ok: false, code: 'attempts' });
  });

  it.each(['calls', 'leads', 'contact_holds'])('erro de leitura em %s = não disca', async (table) => {
    const client = base();
    db.failReads.add(table);
    expect(await gate(client)).toEqual({ ok: false, code: 'error' });
  });

  it('nunca escreve no banco', async () => {
    await gate(base());
    expect(db.writes).toEqual([]);
  });

  it('toda leitura leva org_id', async () => {
    await gate(base());
    for (const r of db.reads.filter((x) => x.table !== 'business_holidays')) expect(r.eq.org_id, r.table).toBe(ORG); // business_holidays é global
  });
});

describe('countMotorCallsToday', () => {
  it('null em erro de leitura', async () => {
    const client = setup([]);
    db.failReads.add('calls');
    expect(await countMotorCallsToday(client, ORG, ME, NOW)).toBeNull();
  });
});
