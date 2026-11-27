import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { DISPOSITION_OPTIONS } from '@/features/calls/disposition';
import { initiateApi4ComCall } from '@/features/calls/actions/initiate-api4com-call';
import { applySdrCallResult } from '@/features/calls/services/apply-sdr-call-result';
import { mergeCallsMetadata } from '@/features/calls/services/merge-calls-metadata';

import { makeAutoDialClient, type AutoDialDb, type Row } from '../services/auto-dial.testkit';
import { armCockpitCallOutcome } from '../services/call-outcome.service';
import { isCockpitAutoDialEnabled, isCockpitAutoDialLive } from '../services/cockpit-auto-dial-flag';
import { buildNextCallCardForLead } from '../services/next-call-card.service';

import {
  confirmAutoDialOutcomeAction,
  dialAutoLeadAction,
  getNextAutoDialCardAction,
  resolveAutoDialNoAnswerAction,
} from './auto-dial';

vi.mock('@/lib/auth/get-org-id', () => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/features/calls/actions/initiate-api4com-call', () => ({ initiateApi4ComCall: vi.fn() }));
vi.mock('@/features/calls/services/apply-sdr-call-result', () => ({ applySdrCallResult: vi.fn() }));
vi.mock('@/features/calls/services/merge-calls-metadata', () => ({ mergeCallsMetadata: vi.fn() }));
vi.mock('@/features/activities/actions/complete-dialer-call', () => ({ completeDialerCall: vi.fn() }));
vi.mock('@/lib/auth/user-directory', () => ({ resolveUserProfiles: vi.fn(async () => new Map()) }));
vi.mock('../services/call-outcome.service', () => ({ armCockpitCallOutcome: vi.fn() }));
vi.mock('../services/cockpit-auto-dial-flag', () => ({ isCockpitAutoDialEnabled: vi.fn(), isCockpitAutoDialLive: vi.fn() }));
vi.mock('../services/next-call-card.service', async (orig) => ({
  ...(await orig<typeof import('../services/next-call-card.service')>()),
  buildNextCallCardForLead: vi.fn(),
}));

import { completeDialerCall } from '@/features/activities/actions/complete-dialer-call';

const ORG = 'org-1';
const ME = '11111111-1111-4111-8111-111111111111';
const LEAD = '22222222-2222-4222-8222-222222222222';
const LEAD_B = '33333333-3333-4333-8333-333333333333';
const CALL = '44444444-4444-4444-8444-444444444444';
/** Sexta 13/11/2026 12:00 BRT. */
const NOW = new Date('2026-11-13T15:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

const lead = (id: string, over: Row = {}): Row => ({ id, org_id: ORG, assigned_to: ME, closer_id: null, deleted_at: null, status: 'contacted', telefone: '11999990000', ...over });
const rpcRow = (id: string, over: Row = {}): Row => ({
  lead_id: id, updated_at: '2026-11-06T00:00:00Z', maybe_hot: false, next_step_due: null, attempts_recent: 0, attempts_window: 0,
  calls_today: 0, last_call_at: null, over_attempts: false, cold_rank: 1, ...over,
});
const callRow = (over: Row = {}): Row => ({
  id: CALL, org_id: ORG, user_id: ME, lead_id: LEAD, created_at: ago(5), started_at: ago(5), answered_at: null, hangup_cause: null,
  metadata: { cockpit_auto_dial: { attempt_no: 1 } }, ...over,
});

/** O navegador manda o modo que ele acredita (expectLive); aqui espelha o que o servidor vai decidir, salvo quando o teste muda isso. */
const dial = async (input: Record<string, unknown>) =>
  dialAutoLeadAction({ expectLive: await isCockpitAutoDialLive({ orgId: ORG, userId: ME }), ...input });

let db: AutoDialDb;
function setup(tables: Record<string, Row[]> = {}, rpcData: Row[] = [rpcRow(LEAD)]) {
  db = {
    tables: { calls: [], contact_holds: [], interactions: [], leads: [lead(LEAD)], custom_fields: [], decision_events: [], ...tables },
    failReads: new Set(),
    reads: [],
    writes: [],
    rpc: vi.fn(async () => ({ data: rpcData, error: null })),
  };
  const client = makeAutoDialClient(db) as never;
  vi.mocked(getAuthOrgIdResult).mockResolvedValue({ success: true, data: { orgId: ORG, userId: ME, role: 'sdr', supabase: client } } as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(client);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(true);
  vi.mocked(isCockpitAutoDialLive).mockResolvedValue(false);
  // `applySdrCallResult` real grava `calls.sdr_disposition`; o serviço RELÊ o valor, então o mock também grava (no fake).
  vi.mocked(applySdrCallResult).mockImplementation(async (_s, input) => {
    const row = db.tables.calls?.find((c) => c.id === input.callId);
    if (row && input.sdrOutcome) row.sdr_disposition = input.sdrOutcome;
    return { success: true, data: { callId: input.callId, leadId: LEAD, notesApplied: true } };
  });
  vi.mocked(mergeCallsMetadata).mockResolvedValue({ updated: true, error: null });
  vi.mocked(armCockpitCallOutcome).mockResolvedValue({ status: 'armed' });
  vi.mocked(buildNextCallCardForLead).mockResolvedValue({ status: 'ok', data: { context: { leadId: LEAD } } as never });
  setup();
});
afterEach(() => vi.useRealTimers());

describe('getNextAutoDialCardAction', () => {
  it('flag desligada: disabled, sem consultar nada', async () => {
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(false);
    expect(await getNextAutoDialCardAction({})).toEqual({ success: true, data: { status: 'disabled' } });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.reads).toEqual([]);
  });

  it('item 6: feriado que só existe em business_holidays bloqueia o motor (união com a lista fixa); erro de leitura = só a lista fixa', async () => {
    db.tables.business_holidays = [{ holiday_date: '2026-11-13' }]; // a "sexta" de teste vira feriado só na tabela
    expect(await getNextAutoDialCardAction({})).toEqual({ success: true, data: { status: 'blocked', code: 'holiday' } });
    expect(db.rpc).not.toHaveBeenCalled();
    db.failReads.add('business_holidays');
    const r = await getNextAutoDialCardAction({});
    expect(r).toMatchObject({ success: true });
    if (r.success) expect(r.data.status).not.toBe('blocked');
  });

  it('fora da janela: blocked sem chamar a RPC (sábado, feriado, 20:00:00)', async () => {
    for (const [iso, code] of [['2026-11-14T15:00:00Z', 'outside_hours'], ['2026-11-20T15:00:00Z', 'holiday'], ['2026-11-13T23:00:00Z', 'outside_hours']] as const) {
      vi.setSystemTime(new Date(iso));
      expect(await getNextAutoDialCardAction({})).toEqual({ success: true, data: { status: 'blocked', code } });
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('teto do motor atingido: blocked daily_cap sem chamar a RPC', async () => {
    const motor = Array.from({ length: 400 }, (_, i) => callRow({ id: `m${i}`, lead_id: LEAD_B }));
    setup({ calls: motor });
    expect(await getNextAutoDialCardAction({})).toEqual({ success: true, data: { status: 'blocked', code: 'daily_cap' } });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('devolve o cartão do lead escolhido, o tier e o live lido no servidor', async () => {
    vi.mocked(isCockpitAutoDialLive).mockResolvedValue(true);
    const r = await getNextAutoDialCardAction({ excludeLeadIds: [LEAD_B] });
    expect(r).toMatchObject({ success: true, data: { status: 'ok', tier: 'cold', live: true } });
    expect(vi.mocked(buildNextCallCardForLead)).toHaveBeenCalledWith(expect.objectContaining({ leadId: LEAD, viewer: expect.objectContaining({ viewerId: ME, targetUserId: ME, orgId: ORG }) }));
    expect(db.rpc).toHaveBeenCalledWith('cockpit_next_call_candidates', expect.objectContaining({ p_exclude_lead_ids: [LEAD_B] }));
  });

  it('FR-24: devolve o contexto extra do lead (origem, perda, último SDR) filtrando por org', async () => {
    setup({
      leads: [lead(LEAD, { lead_source: 'Blackbox', canal: 'whatsapp', lost_at: null, loss_reason_id: null, loss_notes: null, created_at: '2026-01-01T00:00:00Z' })],
    });
    const r = await getNextAutoDialCardAction({});
    expect(r).toMatchObject({ success: true, data: { status: 'ok', leadCardExtras: { leadSource: 'Blackbox', canal: 'whatsapp', previousSdr: null } } });
    for (const read of db.reads.filter((x) => x.table !== 'business_holidays')) expect(read.eq.org_id, read.table).toBe(ORG); // business_holidays é global
  });

  it('o alvo é SEMPRE o próprio usuário (gestor também)', async () => {
    vi.mocked(getAuthOrgIdResult).mockResolvedValue({ success: true, data: { orgId: ORG, userId: ME, role: 'manager', supabase: makeAutoDialClient(db) as never } } as never);
    await getNextAutoDialCardAction({});
    expect(db.rpc).toHaveBeenCalledWith('cockpit_next_call_candidates', expect.objectContaining({ p_target_user_id: ME }));
  });

  it('ninguém liberado: waiting; nada: empty', async () => {
    setup({}, [rpcRow(LEAD, { calls_today: 1, last_call_at: ago(10) })]);
    expect(await getNextAutoDialCardAction({})).toEqual({ success: true, data: { status: 'waiting', until: Date.parse(ago(10)) + 3_600_000 } });
    setup({}, []);
    expect(await getNextAutoDialCardAction({})).toEqual({ success: true, data: { status: 'empty' } });
  });

  it('falha ao escolher = erro (não sugere lead)', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: 'x' } });
    expect(await getNextAutoDialCardAction({})).toMatchObject({ success: false });
  });

  it('entrada inválida é recusada pelo Zod', async () => {
    expect(await getNextAutoDialCardAction({ excludeLeadIds: ['não-uuid'] })).toEqual({ success: false, error: 'Dados inválidos' });
  });
});

describe('dialAutoLeadAction', () => {
  it('recusa com o código do gate e NÃO disca nem escreve', async () => {
    setup({ contact_holds: [{ org_id: ORG, lead_id: LEAD, tipo: 'prospeccao' }] });
    expect(await dial({ leadId: LEAD })).toEqual({ success: true, data: { status: 'refused', code: 'held' } });
    expect(initiateApi4ComCall).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it('flag desligada recusa (flag_off) sem tocar em calls', async () => {
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(false);
    expect(await dial({ leadId: LEAD })).toEqual({ success: true, data: { status: 'refused', code: 'flag_off' } });
    expect(initiateApi4ComCall).not.toHaveBeenCalled();
    expect(db.reads.some((r) => r.table === 'calls')).toBe(false);
  });

  it('SIMULADO (sem cockpit_auto_dial_live): NÃO chama a API4COM, não cria linha em calls, não marca nem arma', async () => {
    const r = await dial({ leadId: LEAD });
    expect(r).toEqual({ success: true, data: { status: 'simulated', attemptNo: 1 } });
    expect(initiateApi4ComCall).not.toHaveBeenCalled();
    expect(mergeCallsMetadata).not.toHaveBeenCalled();
    expect(armCockpitCallOutcome).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it('LIVE: usa o telefone LIDO NO SERVIDOR (o do navegador é ignorado), marca como do motor e arma a IA', async () => {
    vi.mocked(isCockpitAutoDialLive).mockResolvedValue(true);
    vi.mocked(initiateApi4ComCall).mockResolvedValue({ success: true, data: { callId: CALL, api4comId: 'prov-1' } });
    const r = await dial({ leadId: LEAD, phone: '11000000000' });
    expect(initiateApi4ComCall).toHaveBeenCalledTimes(1);
    expect(initiateApi4ComCall).toHaveBeenCalledWith({ phone: '11999990000', leadId: LEAD });
    expect(mergeCallsMetadata).toHaveBeenCalledWith(expect.anything(), CALL, { cockpit_auto_dial: expect.objectContaining({ attempt_no: 1 }) }, { orgId: ORG });
    expect(armCockpitCallOutcome).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orgId: ORG, userId: ME }), CALL);
    expect(r).toEqual({ success: true, data: { status: 'dialed', callId: CALL, providerCallId: 'prov-1', attemptNo: 1 } });
  });

  it('LIVE só com as 3 flags: sem o motor ligado (flag_off) nada é discado mesmo com live', async () => {
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(false);
    vi.mocked(isCockpitAutoDialLive).mockResolvedValue(true);
    expect((await dial({ leadId: LEAD }))).toEqual({ success: true, data: { status: 'refused', code: 'flag_off' } });
    expect(initiateApi4ComCall).not.toHaveBeenCalled();
  });

  it('LIVE: fora da janela, teto, dono e 3 tentativas recusam ANTES de discar', async () => {
    vi.mocked(isCockpitAutoDialLive).mockResolvedValue(true);
    vi.setSystemTime(new Date('2026-11-13T23:00:00Z'));
    expect(await dial({ leadId: LEAD })).toEqual({ success: true, data: { status: 'refused', code: 'outside_hours' } });
    vi.setSystemTime(NOW);
    setup({ leads: [lead(LEAD, { assigned_to: 'outro' })] });
    expect(await dial({ leadId: LEAD })).toEqual({ success: true, data: { status: 'refused', code: 'not_owner' } });
    setup({ calls: [callRow({ id: 'a', created_at: ago(400), metadata: {} }), callRow({ id: 'b', created_at: ago(300), metadata: {} }), callRow({ id: 'c', created_at: ago(200), metadata: {} })] });
    expect(await dial({ leadId: LEAD })).toEqual({ success: true, data: { status: 'refused', code: 'attempts' } });
    expect(initiateApi4ComCall).not.toHaveBeenCalled();
  });

  it('LIVE: se o marcador do motor falhar, tenta de novo UMA vez e o motor SEGUE (a ligação foi feita)', async () => {
    vi.mocked(isCockpitAutoDialLive).mockResolvedValue(true);
    vi.mocked(initiateApi4ComCall).mockResolvedValue({ success: true, data: { callId: CALL, api4comId: 'prov-1' } });
    vi.mocked(mergeCallsMetadata).mockResolvedValueOnce({ updated: false, error: 'falhou' }).mockResolvedValueOnce({ updated: true, error: null });
    expect(await dial({ leadId: LEAD })).toMatchObject({ success: true, data: { status: 'dialed', callId: CALL } });
    expect(mergeCallsMetadata).toHaveBeenCalledTimes(2);
    vi.mocked(mergeCallsMetadata).mockClear();
    vi.mocked(mergeCallsMetadata).mockResolvedValue({ updated: false, error: 'falhou sempre' });
    expect(await dial({ leadId: LEAD })).toMatchObject({ success: true, data: { status: 'dialed' } }); // nunca trava
    expect(mergeCallsMetadata).toHaveBeenCalledTimes(2);
  });

  it('item 2 (live_mismatch): esperava simulado e o servidor é REAL => NÃO disca; esperava real e o servidor é simulado => NÃO disca; iguais => segue', async () => {
    vi.mocked(initiateApi4ComCall).mockResolvedValue({ success: true, data: { callId: CALL, api4comId: 'prov-1' } });
    vi.mocked(isCockpitAutoDialLive).mockResolvedValue(true);
    expect(await dialAutoLeadAction({ leadId: LEAD, expectLive: false })).toEqual({ success: true, data: { status: 'refused', code: 'live_mismatch' } });
    vi.mocked(isCockpitAutoDialLive).mockResolvedValue(false);
    expect(await dialAutoLeadAction({ leadId: LEAD, expectLive: true })).toEqual({ success: true, data: { status: 'refused', code: 'live_mismatch' } });
    expect(initiateApi4ComCall).not.toHaveBeenCalled();
    expect(mergeCallsMetadata).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
    expect(await dialAutoLeadAction({ leadId: LEAD, expectLive: false })).toEqual({ success: true, data: { status: 'simulated', attemptNo: 1 } });
    vi.mocked(isCockpitAutoDialLive).mockResolvedValue(true);
    expect(await dialAutoLeadAction({ leadId: LEAD, expectLive: true })).toMatchObject({ success: true, data: { status: 'dialed' } });
  });

  it('item 2: expectLive é obrigatório (sem ele o Zod recusa e nada é discado)', async () => {
    expect(await dialAutoLeadAction({ leadId: LEAD })).toEqual({ success: false, error: 'Dados inválidos' });
    expect(initiateApi4ComCall).not.toHaveBeenCalled();
  });

  it('LIVE: 424 vira ramal_busy; outro erro vira falha; nada é marcado', async () => {
    vi.mocked(isCockpitAutoDialLive).mockResolvedValue(true);
    vi.mocked(initiateApi4ComCall).mockResolvedValueOnce({ success: false, error: 'ramal ocupado', code: 'ramal_busy' });
    expect(await dial({ leadId: LEAD })).toEqual({ success: true, data: { status: 'ramal_busy', error: 'ramal ocupado' } });
    vi.mocked(initiateApi4ComCall).mockResolvedValueOnce({ success: false, error: 'erro da API' });
    expect(await dial({ leadId: LEAD })).toEqual({ success: false, error: 'erro da API' });
    expect(mergeCallsMetadata).not.toHaveBeenCalled();
  });

  it('LIVE: 422 (número inválido) vira invalid_number para o motor pular o lead; outros erros continuam falhando (A-D12)', async () => {
    vi.mocked(isCockpitAutoDialLive).mockResolvedValue(true);
    vi.mocked(initiateApi4ComCall).mockResolvedValueOnce({ success: false, error: 'API4COM POST /calls failed (422): numero invalido' });
    expect(await dial({ leadId: LEAD })).toEqual({ success: true, data: { status: 'invalid_number', error: 'API4COM POST /calls failed (422): numero invalido' } });
    vi.mocked(initiateApi4ComCall).mockResolvedValueOnce({ success: false, error: 'API4COM POST /calls failed (500)' });
    expect(await dial({ leadId: LEAD })).toMatchObject({ success: false });
    expect(mergeCallsMetadata).not.toHaveBeenCalled();
  });

  it('leadId inválido é recusado pelo Zod', async () => {
    expect(await dial({ leadId: 'x' })).toEqual({ success: false, error: 'Dados inválidos' });
  });
});

describe('resolveAutoDialNoAnswerAction (FR-6/FR-7)', () => {
  const noAnswer = (extra: Row = {}) => callRow({ hangup_cause: 'NO_ANSWER', ...extra });
  const others = (n: number) => Array.from({ length: n }, (_, i) => callRow({ id: `o${i}`, created_at: ago(400 - i * 100), metadata: {} }));

  it('1ª e 2ª tentativa: NÃO grava nada e não avança cadência', async () => {
    for (const n of [0, 1]) {
      setup({ calls: [noAnswer(), ...others(n)] });
      expect(await resolveAutoDialNoAnswerAction({ callId: CALL })).toEqual({ success: true, data: { status: 'not_last', attemptNo: n + 1 } });
    }
    expect(applySdrCallResult).not.toHaveBeenCalled();
  });

  it('3ª tentativa do dia (qualquer origem): grava no_answer, sem completeDialerCall', async () => {
    setup({ calls: [noAnswer(), ...others(2)] });
    expect(await resolveAutoDialNoAnswerAction({ callId: CALL })).toEqual({ success: true, data: { status: 'recorded', attemptNo: 3 } });
    expect(applySdrCallResult).toHaveBeenCalledTimes(1);
    expect(applySdrCallResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ callId: CALL, sdrOutcome: 'no_answer', orgId: ORG, userId: ME }));
    expect(completeDialerCall).not.toHaveBeenCalled();
  });

  it('A-D9: a 3ª grava a nota padrão no MESMO applySdrCallResult (hora da ligação em Brasília); 1ª e 2ª não gravam nada', async () => {
    setup({ calls: [noAnswer(), ...others(2)] });
    await resolveAutoDialNoAnswerAction({ callId: CALL });
    // a ligação nasceu há 5 min: 11h55 em Brasília (NOW = 12h00 BRT)
    expect(applySdrCallResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ notes: '13/11 11h55: não atendeu (tentativa 3/3).' }));
    vi.mocked(applySdrCallResult).mockClear();
    setup({ calls: [noAnswer(), ...others(1)] });
    await resolveAutoDialNoAnswerAction({ callId: CALL });
    expect(applySdrCallResult).not.toHaveBeenCalled();
  });

  it('A-D9: se a ligação já tem nota (do SDR ou da IA), a nota padrão NÃO a cobre', async () => {
    setup({ calls: [noAnswer({ notes: 'SDR: caixa postal da secretária' }), ...others(2)] });
    await resolveAutoDialNoAnswerAction({ callId: CALL });
    const arg = vi.mocked(applySdrCallResult).mock.calls[0]?.[1] as unknown as Record<string, unknown>;
    expect(arg.sdrOutcome).toBe('no_answer');
    expect(arg).not.toHaveProperty('notes');
  });

  it('operadora ainda não confirmou: pending; atendida: answered; sem grava nada', async () => {
    setup({ calls: [callRow()] });
    expect(await resolveAutoDialNoAnswerAction({ callId: CALL })).toEqual({ success: true, data: { status: 'pending' } });
    setup({ calls: [noAnswer({ answered_at: ago(4) })] });
    expect(await resolveAutoDialNoAnswerAction({ callId: CALL })).toEqual({ success: true, data: { status: 'answered' } });
    expect(applySdrCallResult).not.toHaveBeenCalled();
  });

  it('ligação de outro SDR ou que não é do motor: refused', async () => {
    setup({ calls: [noAnswer({ user_id: 'outro' })] });
    expect(await resolveAutoDialNoAnswerAction({ callId: CALL })).toEqual({ success: true, data: { status: 'refused' } });
    setup({ calls: [noAnswer({ metadata: {}, created_at: ago(120), started_at: ago(120) })] }); // sem marcador e criada há 2 h
    expect(await resolveAutoDialNoAnswerAction({ callId: CALL })).toEqual({ success: true, data: { status: 'refused' } });
    expect(applySdrCallResult).not.toHaveBeenCalled();
  });

  it('marcador do motor falhou: a ligação do PRÓPRIO usuário criada há pouco (<30 min) ainda é aceita; de outro usuário, nunca', async () => {
    setup({ calls: [noAnswer({ metadata: {} }), ...others(2)] }); // sem marcador, criada há 5 min, é a 3ª do dia
    expect(await resolveAutoDialNoAnswerAction({ callId: CALL })).toEqual({ success: true, data: { status: 'recorded', attemptNo: 3 } });
    setup({ calls: [noAnswer({ metadata: {}, user_id: 'outro' }), ...others(2)] });
    expect(await resolveAutoDialNoAnswerAction({ callId: CALL })).toEqual({ success: true, data: { status: 'refused' } });
  });

  it('item 5: se o applySdrCallResult diz que gravou mas o desfecho NÃO ficou em calls.sdr_disposition, devolve erro (não diz que gravou)', async () => {
    setup({ calls: [noAnswer(), ...others(2)] });
    vi.mocked(applySdrCallResult).mockResolvedValue({ success: true, data: { callId: CALL, leadId: LEAD, notesApplied: true } }); // não grava no fake
    expect(await resolveAutoDialNoAnswerAction({ callId: CALL })).toMatchObject({ success: false });
  });

  it('flag desligada: refused sem ler a ligação', async () => {
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(false);
    expect(await resolveAutoDialNoAnswerAction({ callId: CALL })).toEqual({ success: true, data: { status: 'refused' } });
    expect(db.reads).toEqual([]);
  });

  it('erro de leitura: falha (não grava)', async () => {
    setup({ calls: [noAnswer()] });
    db.failReads.add('calls');
    expect(await resolveAutoDialNoAnswerAction({ callId: CALL })).toMatchObject({ success: false });
    expect(applySdrCallResult).not.toHaveBeenCalled();
  });

  it('falha ao gravar no_answer na 3ª: erro', async () => {
    setup({ calls: [noAnswer(), ...others(2)] });
    vi.mocked(applySdrCallResult).mockResolvedValue({ success: false, error: 'x' });
    expect(await resolveAutoDialNoAnswerAction({ callId: CALL })).toMatchObject({ success: false });
  });
});

describe('confirmAutoDialOutcomeAction (FR-9)', () => {
  it('aceita `referred_contact` (só do Cockpit), que fica FORA de DISPOSITION_OPTIONS', async () => {
    setup({ calls: [callRow({ answered_at: ago(4) })] });
    expect(await confirmAutoDialOutcomeAction({ callId: CALL, disposition: 'referred_contact' })).toEqual({ success: true, data: { confirmed: true } });
    expect(DISPOSITION_OPTIONS.map((o) => o.value)).not.toContain('referred_contact');
  });

  it('grava o desfecho confirmado, sem avançar cadência (sem completeDialerCall)', async () => {
    setup({ calls: [callRow({ answered_at: ago(4) })] });
    expect(await confirmAutoDialOutcomeAction({ callId: CALL, disposition: 'relevant_conversation', notes: 'ok' })).toEqual({ success: true, data: { confirmed: true } });
    expect(applySdrCallResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ callId: CALL, sdrOutcome: 'relevant_conversation', notes: 'ok', via: 'webphone', orgId: ORG, userId: ME }),
    );
    expect(completeDialerCall).not.toHaveBeenCalled();
  });

  it('desfecho fora da lista é recusado pelo Zod', async () => {
    expect(await confirmAutoDialOutcomeAction({ callId: CALL, disposition: 'qualquer' })).toEqual({ success: false, error: 'Dados inválidos' });
    expect(applySdrCallResult).not.toHaveBeenCalled();
  });

  it('ligação de outro SDR ou não do motor: recusa', async () => {
    setup({ calls: [callRow({ user_id: 'outro' })] });
    expect(await confirmAutoDialOutcomeAction({ callId: CALL, disposition: 'no_answer' })).toMatchObject({ success: false });
    setup({ calls: [callRow({ metadata: {}, created_at: ago(120), started_at: ago(120) })] }); // sem marcador e criada há 2 h
    expect(await confirmAutoDialOutcomeAction({ callId: CALL, disposition: 'no_answer' })).toMatchObject({ success: false });
    expect(applySdrCallResult).not.toHaveBeenCalled();
  });

  it('marcador falhou: ligação do próprio usuário criada há pouco é aceita; e se o desfecho não ficou gravado, devolve erro (item 5)', async () => {
    setup({ calls: [callRow({ metadata: {}, answered_at: ago(4) })] });
    expect(await confirmAutoDialOutcomeAction({ callId: CALL, disposition: 'relevant_conversation' })).toEqual({ success: true, data: { confirmed: true } });
    setup({ calls: [callRow({ metadata: {}, answered_at: ago(4) })] });
    vi.mocked(applySdrCallResult).mockResolvedValue({ success: true, data: { callId: CALL, leadId: LEAD, notesApplied: true } }); // não grava
    expect(await confirmAutoDialOutcomeAction({ callId: CALL, disposition: 'relevant_conversation' })).toMatchObject({ success: false });
  });

  it('motor desligado: recusa', async () => {
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(false);
    expect(await confirmAutoDialOutcomeAction({ callId: CALL, disposition: 'no_answer' })).toMatchObject({ success: false });
  });
});

describe('retorno com contato indicado', () => {
  const CONTACT = '55555555-5555-4555-8555-555555555555';
  const INDICATED = '11988887777';

  const withReturn = () => {
    db.tables.scheduled_activities = [{ org_id: ORG, lead_id: LEAD, channel: 'phone', kind: 'return', status: 'pending', scheduled_at: ago(30), contact_id: CONTACT }];
    db.tables.lead_contacts = [{ id: CONTACT, org_id: ORG, lead_id: LEAD, first_name: 'José', last_name: null, job_title: null, phones: [{ numero: INDICATED }] }];
  };

  beforeEach(() => {
    vi.mocked(isCockpitAutoDialLive).mockResolvedValue(true);
    vi.mocked(initiateApi4ComCall).mockResolvedValue({ success: true, data: { callId: CALL, api4comId: 'p' } });
    vi.mocked(mergeCallsMetadata).mockResolvedValue({ error: null } as never);
    vi.mocked(armCockpitCallOutcome).mockResolvedValue(undefined as never);
  });

  it('disca o número do contato e passa contactId', async () => {
    withReturn();
    expect(await dial({ leadId: LEAD, expectContactId: CONTACT })).toMatchObject({ data: { status: 'dialed' } });
    expect(initiateApi4ComCall).toHaveBeenCalledWith({ phone: INDICATED, leadId: LEAD, contactId: CONTACT });
  });

  it('telefone do indicado editado depois do cartão: não disca; com os mesmos dígitos (formatados) disca', async () => {
    withReturn();
    expect(await dial({ leadId: LEAD, expectContactId: CONTACT, expectContactPhone: '11911112222' })).toEqual({ success: true, data: { status: 'refused', code: 'card_changed' } });
    expect(initiateApi4ComCall).not.toHaveBeenCalled();
    expect(await dial({ leadId: LEAD, expectContactId: CONTACT, expectContactPhone: '(11) 98888-7777' })).toMatchObject({ data: { status: 'dialed' } });
  });

  it('422 no número do indicado marca contactRefused; no principal, não', async () => {
    withReturn();
    vi.mocked(initiateApi4ComCall).mockResolvedValue({ success: false, error: 'API4COM POST /calls failed (422)' });
    expect(await dial({ leadId: LEAD })).toMatchObject({ data: { status: 'invalid_number', contactRefused: true } });
    const again = await dial({ leadId: LEAD, ignoreContact: true, expectContactId: null });
    expect(again).toMatchObject({ data: { status: 'invalid_number' } });
    expect(again).not.toHaveProperty('data.contactRefused');
    expect(initiateApi4ComCall).toHaveBeenLastCalledWith({ phone: '11999990000', leadId: LEAD });
  });

  it('card recebe ignoreContact só para o lead listado', async () => {
    await getNextAutoDialCardAction({ ignoreContactLeadIds: [LEAD] });
    expect(buildNextCallCardForLead).toHaveBeenLastCalledWith(expect.objectContaining({ ignoreContact: true }));
    await getNextAutoDialCardAction({ ignoreContactLeadIds: [LEAD_B] });
    expect(vi.mocked(buildNextCallCardForLead).mock.calls.at(-1)?.[0]).not.toHaveProperty('ignoreContact');
  });

  it('cartão mostrando o principal quando o servidor discaria o contato (ou o contrário): não disca', async () => {
    withReturn();
    expect(await dial({ leadId: LEAD, expectContactId: null })).toEqual({ success: true, data: { status: 'refused', code: 'card_changed' } });
    db.tables.scheduled_activities = [];
    expect(await dial({ leadId: LEAD, expectContactId: CONTACT })).toEqual({ success: true, data: { status: 'refused', code: 'card_changed' } });
    expect(initiateApi4ComCall).not.toHaveBeenCalled();
  });
});
