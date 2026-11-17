import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CockpitViewer } from '../types';
import { NO_ACTION_COOLDOWN_DAYS, NO_ACTION_DISPOSITIONS } from '../utils/no-action-cooldown';

import { makeAutoDialClient, type AutoDialDb, type Row } from './auto-dial.testkit';
import { checkDialGate, loadNoActionLeadIds, pickAutoDialLead } from './cockpit-auto-dial.service';

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

const rpcRow = (id: string, rank: number): Row => ({
  lead_id: id, updated_at: '2026-11-06T00:00:00Z', maybe_hot: false, next_step_due: null, attempts_recent: 0, attempts_window: 0,
  calls_today: 0, last_call_at: null, over_attempts: false, cold_rank: rank,
});
const lead = (id: string, over: Row = {}): Row => ({
  id, org_id: ORG, assigned_to: ME, closer_id: null, deleted_at: null, status: 'contacted', telefone: '11999990000', lost_at: null, loss_reason_id: null, ...over,
});
const call = (leadId: string, daysBack: number, disposition: string | null, over: Row = {}): Row => ({
  id: `c-${leadId}-${daysBack}-${disposition}`, org_id: ORG, user_id: ME, lead_id: leadId, created_at: daysAgo(daysBack), started_at: daysAgo(daysBack),
  answered_at: null, duration_seconds: 0, sdr_disposition: disposition, metadata: {}, ...over,
});
const activity = (leadId: string, over: Row = {}): Row => ({ id: `sa-${leadId}`, org_id: ORG, lead_id: leadId, channel: 'phone', kind: 'return', status: 'pending', scheduled_at: ago(-60 * 24 * 30), ...over });

let db: AutoDialDb;
function setup(rpcData: Row[], tables: Record<string, Row[]> = {}) {
  db = {
    tables: { calls: [], contact_holds: [], interactions: [], leads: [], custom_fields: [], decision_events: [], scheduled_activities: [], loss_reasons: [], ...tables },
    failReads: new Set(),
    reads: [],
    writes: [],
    rpc: vi.fn(async () => ({ data: rpcData, error: null })),
  };
  return makeAutoDialClient(db) as never;
}
const gate = (client: never, leadId = 'A', queue?: 'recovery') =>
  checkDialGate({ orgId: ORG, userId: ME, leadId, now: NOW, queue, holidays: [], client });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(true);
  vi.mocked(isCockpitAutoDialLive).mockResolvedValue(false);
});

describe('lead QUALIFICADO (reunião marcada) fora da fila normal', () => {
  it('escolha: qualified não é escolhido; o próximo elegível sim', async () => {
    const client = setup([rpcRow('Q', 1), rpcRow('B', 2)], { leads: [lead('Q', { status: 'qualified' }), lead('B')] });
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ kind: 'picked', leadId: 'B' });
  });

  it('escolha: qualified com retorno VENCIDO de "Ligar depois" continua elegível (e sobe ao topo)', async () => {
    const client = setup([rpcRow('B', 1), rpcRow('Q', 2)], {
      leads: [lead('Q', { status: 'qualified' }), lead('B')],
      scheduled_activities: [activity('Q', { scheduled_at: ago(30) })],
    });
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toMatchObject({ kind: 'picked', leadId: 'Q', callback: true });
  });

  it('escolha: qualified com retorno FUTURO continua fora', async () => {
    const client = setup([rpcRow('Q', 1)], { leads: [lead('Q', { status: 'qualified' })], scheduled_activities: [activity('Q')] });
    expect(await pickAutoDialLead({ viewer, now: NOW, client })).toEqual({ kind: 'empty' });
  });

  it('portão: qualified recusa; com retorno vencido libera; contacted libera', async () => {
    expect(await gate(setup([], { leads: [lead('A', { status: 'qualified' })] }))).toEqual({ ok: false, code: 'lead_unavailable' });
    expect(
      await gate(setup([], { leads: [lead('A', { status: 'qualified' })], scheduled_activities: [activity('A', { scheduled_at: ago(30) })] })),
    ).toMatchObject({ ok: true });
    expect(await gate(setup([], { leads: [lead('A')] }))).toMatchObject({ ok: true });
  });

  it('a Recuperação não muda: unqualified segue valendo lá', async () => {
    const client = setup([], { leads: [lead('A', { status: 'unqualified', lost_at: daysAgo(10) })] });
    expect(await gate(client, 'A', 'recovery')).toMatchObject({ ok: true });
  });
});

describe('conversa SEM ação final: fora da fila normal por 7 dias', () => {
  it('constantes', () => {
    expect(NO_ACTION_COOLDOWN_DAYS).toBe(7);
    expect([...NO_ACTION_DISPOSITIONS].sort()).toEqual(['answered_no_progress', 'relevant_conversation']);
  });

  it.each(['answered_no_progress', 'relevant_conversation'])('%s ontem, sem atividade pendente: sai (escolha e portão)', async (disposition) => {
    const tables = { leads: [lead('A'), lead('B')], calls: [call('A', 1, disposition)] };
    expect(await pickAutoDialLead({ viewer, now: NOW, client: setup([rpcRow('A', 1), rpcRow('B', 2)], tables) })).toMatchObject({ leadId: 'B' });
    expect(await gate(setup([], tables))).toEqual({ ok: false, code: 'lead_unavailable' });
  });

  it('libera depois de 7 dias (6 dias segura, 8 dias libera)', async () => {
    expect(await gate(setup([], { leads: [lead('A')], calls: [call('A', 6, 'answered_no_progress')] }))).toEqual({ ok: false, code: 'lead_unavailable' });
    expect(await gate(setup([], { leads: [lead('A')], calls: [call('A', 8, 'answered_no_progress')] }))).toMatchObject({ ok: true });
  });

  it.each(['callback_requested', 'no_answer', 'voicemail', 'technical_failure', null])('desfecho %s não exclui', async (disposition) => {
    const tables = { leads: [lead('A')], calls: [call('A', 1, disposition)] };
    expect(await gate(setup([], tables))).toMatchObject({ ok: true });
  });

  it('(a) caso Lippaus: conversa há 1 dia (answered_no_progress) + ligação de hoje 0 s sem desfecho: CONTINUA fora', async () => {
    const tables = { leads: [lead('A')], calls: [call('A', 1, 'answered_no_progress', { duration_seconds: 311, answered_at: daysAgo(1) }), call('A', 0, null, { created_at: ago(180), started_at: ago(180), duration_seconds: 0, status: 'not_significant' })] };
    expect(await gate(setup([], tables))).toEqual({ ok: false, code: 'lead_unavailable' });
    expect(await pickAutoDialLead({ viewer, now: NOW, client: setup([rpcRow('A', 1)], tables) })).toEqual({ kind: 'empty' });
  });

  it.each(['no_answer', 'voicemail', 'technical_failure'])('(b) ligação mais nova com %s: continua fora', async (disposition) => {
    const tables = { leads: [lead('A')], calls: [call('A', 3, 'answered_no_progress'), call('A', 2, disposition)] };
    expect((await loadNoActionLeadIds(setup([], tables), ORG, ['A'], NOW))?.has('A')).toBe(true);
  });

  it('(c) ligação mais nova com callback_requested libera', async () => {
    const tables = { leads: [lead('A')], calls: [call('A', 3, 'answered_no_progress'), call('A', 2, 'callback_requested')] };
    expect((await loadNoActionLeadIds(setup([], tables), ORG, ['A'], NOW))?.has('A')).toBe(false);
    expect(await gate(setup([], tables))).toMatchObject({ ok: true });
  });

  it('(c2) callback_requested ANTERIOR à conversa não libera (a conversa sem ação é a última)', async () => {
    const tables = { leads: [lead('A')], calls: [call('A', 3, 'callback_requested'), call('A', 2, 'answered_no_progress')] };
    expect((await loadNoActionLeadIds(setup([], tables), ORG, ['A'], NOW))?.has('A')).toBe(true);
  });

  it('(d) mais nova que é outra conversa sem ação: continua fora e os 7 dias contam da MAIS NOVA', async () => {
    const older = call('A', 9, 'answered_no_progress'); // sozinha já teria vencido
    const newer = call('A', 6, 'relevant_conversation');
    expect((await loadNoActionLeadIds(setup([], { calls: [older, newer] }), ORG, ['A'], NOW))?.has('A')).toBe(true);
    // 8 dias atrás a conversa mais nova: fora da janela, libera
    expect((await loadNoActionLeadIds(setup([], { calls: [call('A', 12, 'answered_no_progress'), call('A', 8, 'relevant_conversation')] }), ORG, ['A'], NOW))?.has('A')).toBe(false);
  });

  it('retorno pendente (vencido ou futuro) ou tarefa pendente: já tem ação, não exclui', async () => {
    for (const sa of [activity('A'), activity('A', { scheduled_at: ago(30) }), activity('A', { kind: 'task', channel: 'email' })]) {
      const tables = { leads: [lead('A')], calls: [call('A', 1, 'answered_no_progress')], scheduled_activities: [sa] };
      const noAction = await loadNoActionLeadIds(setup([], tables), ORG, ['A'], NOW);
      expect(noAction?.has('A')).toBe(false);
    }
    expect((await loadNoActionLeadIds(setup([], { calls: [call('A', 1, 'answered_no_progress')], scheduled_activities: [activity('A', { status: 'cancelled' })] }), ORG, ['A'], NOW))?.has('A')).toBe(true);
  });

  it('a Recuperação não aplica a regra', async () => {
    const tables = { leads: [lead('A', { status: 'unqualified', lost_at: daysAgo(30) })], calls: [call('A', 1, 'answered_no_progress')] };
    expect(await gate(setup([], tables), 'A', 'recovery')).toMatchObject({ ok: false }); // sai pela regra de conversa depois da perda (A-D4), não por esta
  });

  it('conversa de OUTRA org não conta; falha de leitura = falha fechada; blocos de 100 ids', async () => {
    const other = { ...call('A', 1, 'answered_no_progress'), org_id: 'outra' };
    expect((await loadNoActionLeadIds(setup([], { calls: [other] }), ORG, ['A'], NOW))?.size).toBe(0);
    const client = setup([], { calls: [call('A', 1, 'answered_no_progress')] });
    db.failReads.add('calls');
    expect(await loadNoActionLeadIds(client, ORG, ['A'], NOW)).toBeNull();
    expect(await gate(client)).toEqual({ ok: false, code: 'error' });
    const ids = Array.from({ length: 250 }, (_, i) => `L${i}`);
    const many = setup([], { calls: [call('L7', 1, 'answered_no_progress'), call('L249', 1, 'relevant_conversation')] });
    expect([...(await loadNoActionLeadIds(many, ORG, ids, NOW))!].sort()).toEqual(['L249', 'L7']);
  });

  it('passo 2 filtra callback_requested NO BANCO; respostas com 1000 linhas (qualquer passo) = falha fechada', async () => {
    const tables = { calls: [call('A', 3, 'answered_no_progress')] };
    await loadNoActionLeadIds(setup([], tables), ORG, ['A'], NOW);
    expect(db.reads.some((r) => r.table === 'calls' && r.eq.sdr_disposition === 'callback_requested')).toBe(true);
    const rows = (disposition: string) => Array.from({ length: 1000 }, (_, i) => ({ ...call('A', 1, disposition), id: `r${i}` }));
    // passo 1 lotado
    expect(await loadNoActionLeadIds(setup([], { calls: rows('answered_no_progress') }), ORG, ['A'], NOW)).toBeNull();
    // passo 2 lotado (uma conversa + 1000 callback_requested mais novos)
    const step2 = [call('A', 3, 'answered_no_progress'), ...rows('callback_requested').map((r, i) => ({ ...r, created_at: ago(60 - (i % 50)) }))];
    expect(await loadNoActionLeadIds(setup([], { calls: step2 }), ORG, ['A'], NOW)).toBeNull();
  });
});
