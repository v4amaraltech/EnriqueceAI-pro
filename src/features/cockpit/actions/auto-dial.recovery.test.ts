import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { initiateApi4ComCall } from '@/features/calls/actions/initiate-api4com-call';
import { mergeCallsMetadata } from '@/features/calls/services/merge-calls-metadata';

import { armCockpitCallOutcome } from '../services/call-outcome.service';
import { makeAutoDialClient, type AutoDialDb, type Row } from '../services/auto-dial.testkit';
import { isCockpitAutoDialEnabled, isCockpitAutoDialLive } from '../services/cockpit-auto-dial-flag';
import { buildNextCallCardForLead } from '../services/next-call-card.service';

import { dialAutoLeadAction, getNextAutoDialCardAction } from './auto-dial';

vi.mock('@/lib/auth/get-org-id', () => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/lib/auth/user-directory', () => ({ resolveUserProfiles: vi.fn(async () => new Map()) }));
vi.mock('@/features/calls/actions/initiate-api4com-call', () => ({ initiateApi4ComCall: vi.fn() }));
vi.mock('@/features/calls/services/apply-sdr-call-result', () => ({ applySdrCallResult: vi.fn() }));
vi.mock('@/features/calls/services/merge-calls-metadata', () => ({ mergeCallsMetadata: vi.fn() }));
vi.mock('../services/call-outcome.service', () => ({ armCockpitCallOutcome: vi.fn() }));
vi.mock('../services/cockpit-auto-dial-flag', () => ({ isCockpitAutoDialEnabled: vi.fn(), isCockpitAutoDialLive: vi.fn() }));
vi.mock('../services/next-call-card.service', async (orig) => ({
  ...(await orig<typeof import('../services/next-call-card.service')>()),
  buildNextCallCardForLead: vi.fn(),
}));

const ORG = 'org-1';
const ME = '11111111-1111-4111-8111-111111111111';
const LEAD = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-13T15:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const lostLead = (over: Row = {}): Row => ({
  id: LEAD, org_id: ORG, assigned_to: ME, closer_id: null, deleted_at: null, status: 'unqualified', telefone: '11999990000',
  lost_at: daysAgo(10), loss_reason_id: 'r1', lead_source: 'Blackbox', canal: 'whatsapp', created_at: daysAgo(100), loss_notes: 'sem budget', ...over,
});

/** O navegador manda o modo que ele acredita (expectLive); aqui espelha o que o servidor vai decidir, salvo quando o teste muda isso. */
const dial = async (input: Record<string, unknown>) =>
  dialAutoLeadAction({ expectLive: await isCockpitAutoDialLive({ orgId: ORG, userId: ME }), ...input });

let db: AutoDialDb;
function setup(recovery: Row[] = [{ lead_id: LEAD, lost_at: daysAgo(10), loss_reason_name: 'Sem budget', updated_at: daysAgo(10), calls_today: 0, attempts_window: 0, last_call_at: null, conversation_today: false, callback_pending: false, recovery_rank: 1 }], leads: Row[] = [lostLead()]) {
  db = {
    tables: { calls: [], contact_holds: [], interactions: [], leads, custom_fields: [], decision_events: [], scheduled_activities: [], loss_reasons: [{ id: 'r1', org_id: ORG, name: 'Sem budget' }], cadence_enrollments: [] },
    failReads: new Set(),
    reads: [],
    writes: [],
    rpc: vi.fn(async (name: unknown) => ({ data: name === 'cockpit_recovery_candidates' ? recovery : [], error: null })),
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
  vi.mocked(mergeCallsMetadata).mockResolvedValue({ updated: true, error: null });
  vi.mocked(armCockpitCallOutcome).mockResolvedValue({ status: 'armed' });
  vi.mocked(buildNextCallCardForLead).mockResolvedValue({ status: 'ok', data: { context: { leadId: LEAD, company: { status: 'unqualified' } } } as never });
  setup();
});
afterEach(() => vi.useRealTimers());

describe('getNextAutoDialCardAction com queue', () => {
  it('queue "recovery": usa a função de recuperação, devolve queue e o lead PERDIDO (status unqualified no contexto, para o painel esconder Desqualificar)', async () => {
    const r = await getNextAutoDialCardAction({ queue: 'recovery' });
    expect(r).toMatchObject({ success: true, data: { status: 'ok', queue: 'recovery', leadCardExtras: { lostAt: daysAgo(10), lossReasonName: 'Sem budget', lossNotes: 'sem budget', leadSource: 'Blackbox' } } });
    expect(vi.mocked(db.rpc).mock.calls.map((c) => c[0])).toEqual(['cockpit_recovery_candidates']);
    if (r.success && r.data.status === 'ok') expect(r.data.card.context.company.status).toBe('unqualified');
    // o rótulo "mostrando frio" é da fila normal: na recuperação o cartão sai sem selo de tier
    expect(vi.mocked(buildNextCallCardForLead).mock.calls[0]?.[0]).toMatchObject({ leadId: LEAD, tier: undefined });
    for (const read of db.reads.filter((x) => x.table !== 'business_holidays')) expect(read.eq.org_id, read.table).toBe(ORG); // business_holidays é global
  });

  it('sem queue (ou "normal"): comportamento ATUAL idêntico (RPC do #641, queue normal no resultado, tier do #641)', async () => {
    setup([], [lostLead({ status: 'contacted' })]);
    db.rpc.mockImplementation(async () => ({ data: [{ lead_id: LEAD, updated_at: 'x', maybe_hot: false, next_step_due: null, attempts_recent: 0, attempts_window: 0, calls_today: 0, last_call_at: null, over_attempts: false, cold_rank: 1 }], error: null }));
    const r = await getNextAutoDialCardAction({});
    expect(r).toMatchObject({ success: true, data: { status: 'ok', queue: 'normal', tier: 'cold' } });
    expect(vi.mocked(db.rpc).mock.calls.map((c) => c[0])).toEqual(['cockpit_next_call_candidates']);
    expect(vi.mocked(buildNextCallCardForLead).mock.calls[0]?.[0]).toMatchObject({ tier: 'cold' });
  });

  it('as MESMAS travas valem na recuperação: janela e teto bloqueiam antes de chamar a função', async () => {
    vi.setSystemTime(new Date('2026-11-14T15:00:00Z'));
    expect(await getNextAutoDialCardAction({ queue: 'recovery' })).toEqual({ success: true, data: { status: 'blocked', code: 'outside_hours' } });
    vi.setSystemTime(NOW);
    const motor = Array.from({ length: 400 }, (_, i) => ({ id: `m${i}`, org_id: ORG, user_id: ME, lead_id: 'Z', started_at: daysAgo(0), created_at: daysAgo(0), metadata: { cockpit_auto_dial: {} } }));
    setup(undefined, [lostLead()]);
    db.tables.calls = motor;
    expect(await getNextAutoDialCardAction({ queue: 'recovery' })).toEqual({ success: true, data: { status: 'blocked', code: 'daily_cap' } });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('flag desligada: disabled, sem chamar nenhuma função; queue inválida é recusada pelo Zod', async () => {
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(false);
    expect(await getNextAutoDialCardAction({ queue: 'recovery' })).toEqual({ success: true, data: { status: 'disabled' } });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(await getNextAutoDialCardAction({ queue: 'qualquer' })).toEqual({ success: false, error: 'Dados inválidos' });
  });

  it('erro da função de recuperação = erro (não sugere lead)', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: 'x' } });
    expect(await getNextAutoDialCardAction({ queue: 'recovery' })).toMatchObject({ success: false });
  });
});

describe('dialAutoLeadAction com queue', () => {
  it('lead perdido: recuperação libera (simulado, sem API4COM, sem escrever); fila normal ou sem queue recusa', async () => {
    expect(await dial({ leadId: LEAD, queue: 'recovery' })).toEqual({ success: true, data: { status: 'simulated', attemptNo: 1 } });
    expect(await dial({ leadId: LEAD })).toEqual({ success: true, data: { status: 'refused', code: 'lead_unavailable' } });
    expect(await dial({ leadId: LEAD, queue: 'normal' })).toEqual({ success: true, data: { status: 'refused', code: 'lead_unavailable' } });
    expect(initiateApi4ComCall).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it('o navegador não consegue discar lead NÃO perdido pela recuperação, nem de motivo bloqueado', async () => {
    setup(undefined, [lostLead({ status: 'contacted' })]);
    expect(await dial({ leadId: LEAD, queue: 'recovery' })).toEqual({ success: true, data: { status: 'refused', code: 'lead_unavailable' } });
    setup(undefined, [lostLead({ loss_reason_id: 'r-block' })]);
    db.tables.loss_reasons = [{ id: 'r-block', org_id: ORG, name: 'Blocklist' }];
    expect(await dial({ leadId: LEAD, queue: 'recovery' })).toEqual({ success: true, data: { status: 'refused', code: 'lead_unavailable' } });
    expect(initiateApi4ComCall).not.toHaveBeenCalled();
  });

  it('LIVE na recuperação: só com as 3 flags (lidas no servidor), telefone do servidor', async () => {
    vi.mocked(isCockpitAutoDialLive).mockResolvedValue(true);
    vi.mocked(initiateApi4ComCall).mockResolvedValue({ success: true, data: { callId: 'call-1', api4comId: 'prov-1' } });
    const r = await dial({ leadId: LEAD, queue: 'recovery', phone: '11000000000' });
    expect(initiateApi4ComCall).toHaveBeenCalledWith({ phone: '11999990000', leadId: LEAD });
    expect(r).toMatchObject({ success: true, data: { status: 'dialed', callId: 'call-1' } });
    vi.mocked(initiateApi4ComCall).mockClear();
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(false);
    expect(await dial({ leadId: LEAD, queue: 'recovery' })).toEqual({ success: true, data: { status: 'refused', code: 'flag_off' } });
    expect(initiateApi4ComCall).not.toHaveBeenCalled();
  });
});
