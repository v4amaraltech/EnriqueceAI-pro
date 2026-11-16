import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CockpitViewer } from '../types';
import { RECOVERY_BLOCKED_REASON_NAMES } from '../utils/recovery-queue';

import { makeAutoDialClient, type AutoDialDb, type Row } from './auto-dial.testkit';
import { checkDialGate, pickAutoDialLead } from './cockpit-auto-dial.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('./cockpit-auto-dial-flag', () => ({ isCockpitAutoDialEnabled: vi.fn(), isCockpitAutoDialLive: vi.fn() }));

import { isCockpitAutoDialEnabled, isCockpitAutoDialLive } from './cockpit-auto-dial-flag';

/** Sexta 13/11/2026 12:00 BRT. */
const NOW = new Date('2026-11-13T15:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const daysAgo = (d: number) => ago(d * 24 * 60);
const ORG = 'org-1';
const ME = 'user-1';
const viewer: CockpitViewer = { viewerId: ME, orgId: ORG, isManager: false, targetUserId: ME, targetName: 'U', sdrOptions: [] };

const rec = (id: string, rank: number, over: Row = {}): Row => ({
  lead_id: id, lost_at: daysAgo(10), loss_reason_name: 'Sem interesse', updated_at: '2026-11-06T00:00:00Z', calls_today: 0, attempts_window: 0,
  last_call_at: null, conversation_today: false, callback_pending: false, recovery_rank: rank, ...over,
});
const normal = (id: string, rank: number): Row => ({
  lead_id: id, updated_at: '2026-11-06T00:00:00Z', maybe_hot: false, next_step_due: null, attempts_recent: 0, attempts_window: 0,
  calls_today: 0, last_call_at: null, over_attempts: false, cold_rank: rank,
});
const lostLead = (id: string, over: Row = {}): Row => ({
  id, org_id: ORG, assigned_to: ME, closer_id: null, deleted_at: null, status: 'unqualified', telefone: '11999990000', lost_at: daysAgo(10), loss_reason_id: 'r-ok', ...over,
});
const call = (over: Row = {}): Row => ({
  id: `c-${Math.random()}`, org_id: ORG, user_id: ME, lead_id: 'A', created_at: ago(300), started_at: ago(300), answered_at: null,
  duration_seconds: 0, sdr_disposition: null, metadata: {}, ...over,
});
const callback = (leadId: string, minAgo: number): Row => ({ id: `sa-${leadId}`, org_id: ORG, lead_id: leadId, channel: 'phone', kind: 'return', status: 'pending', scheduled_at: ago(minAgo) });

let db: AutoDialDb;
function setup(recovery: Row[] | null, tables: Record<string, Row[]> = {}, normalRows: Row[] = []) {
  db = {
    tables: {
      calls: [], contact_holds: [], interactions: [], leads: [lostLead('A')], custom_fields: [], decision_events: [], scheduled_activities: [],
      loss_reasons: [{ id: 'r-ok', org_id: ORG, name: 'Sem interesse' }, { id: 'r-block', org_id: ORG, name: 'Blocklist' }, { id: 'r-cliente', org_id: ORG, name: 'Cliente' }],
      ...tables,
    },
    failReads: new Set(),
    reads: [],
    writes: [],
    rpc: vi.fn(async (name: unknown) => {
      if (name === 'cockpit_recovery_candidates') return recovery === null ? { data: null, error: { message: 'rpc falhou' } } : { data: recovery, error: null };
      return { data: normalRows, error: null };
    }),
  };
  return makeAutoDialClient(db) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(true);
  vi.mocked(isCockpitAutoDialLive).mockResolvedValue(false);
});

describe('pickAutoDialLead: fila de recuperação', () => {
  it('chama a função de RECUPERAÇÃO (não a do #641) com org e usuário do viewer, excluídos NO CORPO, limite e motivos bloqueados', async () => {
    const client = setup([rec('A', 1)]);
    await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', excludeLeadIds: ['x1', 'x2'], client });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith(
      'cockpit_recovery_candidates',
      expect.objectContaining({
        p_org_id: ORG,
        p_target_user_id: ME,
        p_exclude_lead_ids: ['x1', 'x2'],
        p_limit: 1000,
        p_blocked_reason_names: [...RECOVERY_BLOCKED_REASON_NAMES],
        p_max_attempts_per_day: 3,
        p_now: NOW.toISOString(),
      }),
    );
  });

  it('D-14: a ordem vem do SQL (recovery_rank): o rank 1 vence, mesmo vindo por último na lista', async () => {
    const client = setup([rec('C', 3), rec('B', 2), rec('A', 1)]);
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client })).toMatchObject({ kind: 'picked', leadId: 'A' });
  });

  it('normal INTACTO: sem o parâmetro (ou com "normal") chama só a RPC do #641 e a escolha é a de sempre', async () => {
    const client = setup([rec('A', 1)], {}, [normal('N', 1)]);
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ kind: 'picked', leadId: 'N', tier: 'cold' });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.rpc).mock.calls[0]?.[0]).toBe('cockpit_next_call_candidates');
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'normal', client })).toMatchObject({ leadId: 'N' });
  });

  it('o MESMO portão: contact_holds prospeccao e total tiram o lead', async () => {
    const prosp = setup([rec('A', 1), rec('B', 2)], { contact_holds: [{ org_id: ORG, lead_id: 'A', tipo: 'prospeccao' }] });
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client: prosp })).toMatchObject({ leadId: 'B' });
    const total = setup([rec('A', 1), rec('B', 2)], { contact_holds: [{ org_id: ORG, lead_id: 'A', tipo: 'total' }] });
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client: total })).toMatchObject({ leadId: 'B' });
  });

  it('o MESMO portão: 3 por dia e intervalo de 1 h (59 min espera; 60 libera)', async () => {
    const three = setup([rec('A', 1, { calls_today: 3, last_call_at: ago(400) }), rec('B', 2)]);
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client: three })).toMatchObject({ leadId: 'B' });
    const gap = setup([rec('A', 1, { calls_today: 1, last_call_at: ago(59) }), rec('B', 2, { calls_today: 1, last_call_at: ago(20) })]);
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client: gap })).toEqual({ kind: 'waiting', until: Date.parse(ago(59)) + 3_600_000 });
    const ok = setup([rec('A', 1, { calls_today: 1, last_call_at: ago(60) })]);
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client: ok })).toMatchObject({ leadId: 'A' });
  });

  it('o MESMO portão: conversa real HOJE tira o lead (caixa postal não); simulado conta', async () => {
    const rows = [rec('A', 1, { calls_today: 1, last_call_at: ago(200) }), rec('B', 2)];
    const talked = setup(rows, { calls: [call({ lead_id: 'A', created_at: ago(200), started_at: ago(200), answered_at: ago(199), duration_seconds: 120 })] });
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client: talked })).toMatchObject({ leadId: 'B' });
    const voicemail = setup(rows, { calls: [call({ lead_id: 'A', created_at: ago(200), started_at: ago(200), answered_at: ago(199), duration_seconds: 7, sdr_disposition: 'voicemail' })] });
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client: voicemail })).toMatchObject({ leadId: 'A' });
    const sim = setup([rec('A', 1), rec('B', 2)]);
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client: sim, simulatedAttempts: { A: [ago(400), ago(300), ago(200)] } })).toMatchObject({ leadId: 'B' });
  });

  it('retorno vencido fura "conversa hoje" e o intervalo, e vai ao TOPO também na recuperação', async () => {
    const client = setup([rec('A', 1), rec('B', 2, { calls_today: 1, last_call_at: ago(200) })], {
      calls: [call({ lead_id: 'B', created_at: ago(200), started_at: ago(200), answered_at: ago(199), duration_seconds: 120, sdr_disposition: 'callback_requested' })],
      scheduled_activities: [callback('B', 30)],
    });
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client })).toMatchObject({ leadId: 'B', callback: true });
  });

  it('falha fechada: RPC com erro, leitura de bloqueios ou de ligações = erro', async () => {
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client: setup(null) })).toEqual({ kind: 'error' });
    const holds = setup([rec('A', 1)]);
    db.failReads.add('contact_holds');
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client: holds })).toEqual({ kind: 'error' });
    const calls = setup([rec('A', 1)]);
    db.failReads.add('calls');
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client: calls })).toEqual({ kind: 'error' });
  });

  it('fila vazia = empty; org isolada (toda leitura direta leva org_id); nada é escrito', async () => {
    expect(await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client: setup([]) })).toEqual({ kind: 'empty' });
    const client = setup([rec('A', 1)]);
    await pickAutoDialLead({ viewer, now: NOW, queue: 'recovery', client });
    for (const r of db.reads.filter((x) => x.table !== 'business_holidays')) expect(r.eq.org_id, r.table).toBe(ORG); // business_holidays é global
    expect(db.writes).toEqual([]);
  });
});

describe('checkDialGate: fila de recuperação', () => {
  const gate = (client: never, queue?: 'normal' | 'recovery', at: Date = NOW) => checkDialGate({ orgId: ORG, userId: ME, leadId: 'A', now: at, queue, client });

  it('perdido: a fila NORMAL recusa (lead_unavailable) e a RECUPERAÇÃO libera', async () => {
    expect(await gate(setup([]), undefined)).toEqual({ ok: false, code: 'lead_unavailable' });
    expect(await gate(setup([]), 'normal')).toEqual({ ok: false, code: 'lead_unavailable' });
    expect(await gate(setup([]), 'recovery')).toMatchObject({ ok: true, phone: '11999990000', attemptNo: 1 });
  });

  it('recuperação SÓ aceita perdido de verdade: reaberto, arquivado ou sem lost_at recusam', async () => {
    for (const over of [{ status: 'qualified' }, { status: 'contacted' }, { status: 'archived' }, { lost_at: null }]) {
      expect(await gate(setup([], { leads: [lostLead('A', over)] }), 'recovery'), JSON.stringify(over)).toEqual({ ok: false, code: 'lead_unavailable' });
    }
  });

  it('A-D5 reconferido no portão: motivo bloqueado recusa; "Cliente" passa; erro de leitura do motivo = não disca', async () => {
    expect(await gate(setup([], { leads: [lostLead('A', { loss_reason_id: 'r-block' })] }), 'recovery')).toEqual({ ok: false, code: 'lead_unavailable' });
    expect(await gate(setup([], { leads: [lostLead('A', { loss_reason_id: 'r-cliente' })] }), 'recovery')).toMatchObject({ ok: true });
    const client = setup([]);
    db.failReads.add('loss_reasons');
    expect(await gate(client, 'recovery')).toEqual({ ok: false, code: 'error' });
  });

  it('A-D4 reconferido no portão: conversa real DEPOIS da perda recusa; antes da perda não; retorno vencido fura', async () => {
    const after = setup([], { calls: [call({ created_at: daysAgo(3), started_at: daysAgo(3), answered_at: daysAgo(3), duration_seconds: 90 })] });
    expect(await gate(after, 'recovery')).toEqual({ ok: false, code: 'answered_today' });
    const before = setup([], { calls: [call({ created_at: daysAgo(20), started_at: daysAgo(20), answered_at: daysAgo(20), duration_seconds: 90 })] });
    expect(await gate(before, 'recovery')).toMatchObject({ ok: true });
    const withCb = setup([], { calls: [call({ created_at: daysAgo(3), started_at: daysAgo(3), answered_at: daysAgo(3), duration_seconds: 90 })], scheduled_activities: [callback('A', 30)] });
    expect(await gate(withCb, 'recovery')).toMatchObject({ ok: true });
  });

  it('o resto do portão vale igual: janela, dono, bloqueio, 3/dia, 1 h, teto', async () => {
    expect(await gate(setup([]), 'recovery', new Date('2026-11-13T23:00:00Z'))).toEqual({ ok: false, code: 'outside_hours' });
    expect(await gate(setup([], { leads: [lostLead('A', { assigned_to: 'outro' })] }), 'recovery')).toEqual({ ok: false, code: 'not_owner' });
    expect(await gate(setup([], { contact_holds: [{ org_id: ORG, lead_id: 'A', tipo: 'prospeccao' }] }), 'recovery')).toEqual({ ok: false, code: 'held' });
    const three = [1, 2, 3].map((n) => call({ id: `x${n}`, created_at: ago(400 - n * 100), started_at: ago(400 - n * 100) }));
    expect(await gate(setup([], { calls: three }), 'recovery')).toEqual({ ok: false, code: 'attempts' });
    expect(await gate(setup([], { calls: [call({ created_at: ago(30), started_at: ago(30) })] }), 'recovery')).toEqual({ ok: false, code: 'gap' });
    const motor = Array.from({ length: 400 }, (_, i) => call({ id: `m${i}`, lead_id: 'Z', started_at: ago(200), metadata: { cockpit_auto_dial: {} } }));
    expect(await gate(setup([], { calls: motor }), 'recovery')).toEqual({ ok: false, code: 'daily_cap' });
  });

  it('flag desligada recusa sem ler nada; nunca escreve', async () => {
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(false);
    const client = setup([]);
    expect(await gate(client, 'recovery')).toEqual({ ok: false, code: 'flag_off' });
    expect(db.reads).toEqual([]);
    expect(db.writes).toEqual([]);
  });
});
