import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { applySdrCallResult } from '@/features/calls/services/apply-sdr-call-result';

import { makeAutoDialClient, type AutoDialDb, type Row } from '../services/auto-dial.testkit';
import { isCockpitAutoDialEnabled } from '../services/cockpit-auto-dial-flag';

import { concludeAutoDialCallAction } from './auto-dial';

vi.mock('@/lib/auth/get-org-id', () => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/features/calls/actions/initiate-api4com-call', () => ({ initiateApi4ComCall: vi.fn() }));
vi.mock('@/features/calls/services/apply-sdr-call-result', () => ({ applySdrCallResult: vi.fn() }));
vi.mock('@/features/calls/services/merge-calls-metadata', () => ({ mergeCallsMetadata: vi.fn() }));
vi.mock('@/features/activities/actions/complete-dialer-call', () => ({ completeDialerCall: vi.fn() }));
vi.mock('../services/call-outcome.service', () => ({ armCockpitCallOutcome: vi.fn() }));
vi.mock('../services/cockpit-auto-dial-flag', () => ({ isCockpitAutoDialEnabled: vi.fn(), isCockpitAutoDialLive: vi.fn() }));

import { completeDialerCall } from '@/features/activities/actions/complete-dialer-call';

const ORG = 'org-1';
const ME = '11111111-1111-4111-8111-111111111111';
const CALL = '44444444-4444-4444-8444-444444444444';

const callRow = (over: Row = {}): Row => ({
  id: CALL, org_id: ORG, user_id: ME, lead_id: 'L', answered_at: '2026-11-13T15:00:05Z', hangup_cause: null,
  metadata: { cockpit_auto_dial: { attempt_no: 1 } }, ...over,
});

let db: AutoDialDb;
function setup(calls: Row[]) {
  db = { tables: { calls }, failReads: new Set(), reads: [], writes: [], rpc: vi.fn() };
  const client = makeAutoDialClient(db) as never;
  vi.mocked(getAuthOrgIdResult).mockResolvedValue({ success: true, data: { orgId: ORG, userId: ME, role: 'sdr', supabase: client } } as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(client);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(true);
  // `applySdrCallResult` real grava `calls.sdr_disposition`; o serviço RELÊ o valor, então o mock também grava (no fake).
  vi.mocked(applySdrCallResult).mockImplementation(async (_s, input) => {
    const row = db.tables.calls?.find((c) => c.id === input.callId);
    if (row && input.sdrOutcome) row.sdr_disposition = input.sdrOutcome;
    return { success: true, data: { callId: input.callId, leadId: 'L', notesApplied: true } };
  });
});

describe('concludeAutoDialCallAction', () => {
  it.each([
    ['scheduled', 'relevant_conversation'],
    ['lost', 'answered_no_progress'],
    ['callback', 'callback_requested'],
  ] as const)('ligação atendida + %s → grava %s, sem avançar cadência', async (kind, disposition) => {
    setup([callRow()]);
    expect(await concludeAutoDialCallAction({ callId: CALL, kind })).toEqual({ success: true, data: { status: 'recorded', disposition } });
    expect(applySdrCallResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ callId: CALL, sdrOutcome: disposition, orgId: ORG, userId: ME, via: 'webphone' }));
    expect(completeDialerCall).not.toHaveBeenCalled();
  });

  it('ligação NÃO atendida (hangup sem answered_at): no_answer, para não contradizer a telemetria', async () => {
    setup([callRow({ answered_at: null, hangup_cause: 'NO_ANSWER' })]);
    expect(await concludeAutoDialCallAction({ callId: CALL, kind: 'lost' })).toEqual({ success: true, data: { status: 'recorded', disposition: 'no_answer' } });
  });

  it('item 5: gravou mas o desfecho não ficou em calls.sdr_disposition => erro; item 4: ligação própria recente sem marcador é aceita', async () => {
    setup([callRow({ metadata: {}, created_at: new Date().toISOString() })]);
    expect(await concludeAutoDialCallAction({ callId: CALL, kind: 'scheduled' })).toMatchObject({ success: true, data: { status: 'recorded' } });
    setup([callRow()]);
    vi.mocked(applySdrCallResult).mockResolvedValue({ success: true, data: { callId: CALL, leadId: 'L', notesApplied: true } }); // não grava
    expect(await concludeAutoDialCallAction({ callId: CALL, kind: 'scheduled' })).toMatchObject({ success: false });
  });

  it('operadora ainda não informou: pending e NADA gravado', async () => {
    setup([callRow({ answered_at: null, hangup_cause: null })]);
    expect(await concludeAutoDialCallAction({ callId: CALL, kind: 'lost' })).toEqual({ success: true, data: { status: 'pending' } });
    expect(applySdrCallResult).not.toHaveBeenCalled();
  });

  it('ligação de outro SDR ou que não é do motor: refused', async () => {
    setup([callRow({ user_id: 'outro' })]);
    expect(await concludeAutoDialCallAction({ callId: CALL, kind: 'lost' })).toEqual({ success: true, data: { status: 'refused' } });
    setup([callRow({ metadata: {} })]);
    expect(await concludeAutoDialCallAction({ callId: CALL, kind: 'scheduled' })).toEqual({ success: true, data: { status: 'refused' } });
    expect(applySdrCallResult).not.toHaveBeenCalled();
  });

  it('motor desligado: refused sem ler a ligação', async () => {
    setup([callRow()]);
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(false);
    expect(await concludeAutoDialCallAction({ callId: CALL, kind: 'lost' })).toEqual({ success: true, data: { status: 'refused' } });
    expect(db.reads).toEqual([]);
  });

  it('erro de leitura ou de gravação: falha (não finge que gravou)', async () => {
    setup([callRow()]);
    db.failReads.add('calls');
    expect(await concludeAutoDialCallAction({ callId: CALL, kind: 'lost' })).toMatchObject({ success: false });
    setup([callRow()]);
    vi.mocked(applySdrCallResult).mockResolvedValue({ success: false, error: 'x' });
    expect(await concludeAutoDialCallAction({ callId: CALL, kind: 'lost' })).toMatchObject({ success: false });
  });

  it('entrada inválida: Zod recusa (kind fora de scheduled/lost, callId não-uuid)', async () => {
    setup([callRow()]);
    expect(await concludeAutoDialCallAction({ callId: CALL, kind: 'won' })).toEqual({ success: false, error: 'Dados inválidos' });
    expect(await concludeAutoDialCallAction({ callId: 'x', kind: 'lost' })).toEqual({ success: false, error: 'Dados inválidos' });
  });
});
