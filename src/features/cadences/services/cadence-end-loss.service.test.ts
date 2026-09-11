import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));
const webhook = vi.hoisted(() => ({ dispatchWebhookEvent: vi.fn() }));
const recovery = vi.hoisted(() => ({
  scheduleInboundRecovery: vi.fn(),
  getInboundRecoveryCadenceId: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => service);
vi.mock('./webhook-dispatch.service', () => webhook);
vi.mock('@/features/leads/services/inbound-recovery.service', () => recovery);

import {
  CADENCE_END_LOSS_NOTES,
  markLeadLostOnCadenceEnd,
  pickCadenceEndLossReasonName,
} from './cadence-end-loss.service';

const ORG = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
const RECOVERY = '15a05299-1627-40d1-be81-80150a4f1308';
const REASON_NUNCA = { id: 'b1a85355-bdf8-4d53-b0ee-52dd0067ae23', name: 'Nunca respondeu' };
const REASON_DEIXOU = { id: '863d2e55-7160-4d2a-818c-94846d3040da', name: 'Deixou de responder' };

const PARAMS = { orgId: ORG, leadId: 'lead-1', cadenceId: 'cad-fria', enrollmentId: 'enr-1' };

interface Captured {
  table: string;
  op: 'update' | 'insert';
  payload: Record<string, unknown>;
  filters: string[];
}

let captured: Captured[];
let leadStatus: string | null;
let openEnrollments: Array<{ id: string }>;
let pendingReturns: Array<{ id: string }>;
let reasons: Array<{ id: string; name: string }>;
let reasonFilter: string | undefined;
/** Linhas que o UPDATE do lead devolve (vazio = status mudou no meio do caminho). */
let leadUpdateRows: Array<{ id: string }>;

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const filters: string[] = [];
  let op: Captured['op'] | null = null;

  const passthrough = (name: string) =>
    vi.fn((...args: unknown[]) => {
      filters.push(`${name}:${String(args[0])}:${JSON.stringify(args[1])}`);
      return chain;
    });

  chain.select = vi.fn(() => chain);
  chain.eq = passthrough('eq');
  chain.is = passthrough('is');
  chain.in = passthrough('in');
  chain.limit = vi.fn(() => chain);
  chain.ilike = vi.fn((_col: string, value: string) => {
    reasonFilter = value;
    return chain;
  });
  chain.update = vi.fn((payload: Record<string, unknown>) => {
    op = 'update';
    captured.push({ table, op, payload, filters });
    return chain;
  });
  chain.insert = vi.fn((payload: Record<string, unknown>) => {
    captured.push({ table, op: 'insert', payload, filters });
    return Promise.resolve({ error: null });
  });
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: table === 'leads' && leadStatus ? { status: leadStatus } : null }),
  );

  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    let result: unknown = { data: null, error: null };
    if (table === 'cadence_enrollments' && !op) result = { data: openEnrollments, error: null };
    else if (table === 'scheduled_activities') result = { data: pendingReturns, error: null };
    else if (table === 'loss_reasons') result = { data: reasons, error: null };
    else if (table === 'leads' && op === 'update') result = { data: leadUpdateRows, error: null };
    return Promise.resolve(result).then(resolve, reject);
  };

  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  captured = [];
  leadStatus = 'contacted';
  openEnrollments = [];
  pendingReturns = [];
  reasons = [REASON_NUNCA];
  reasonFilter = undefined;
  leadUpdateRows = [{ id: 'lead-1' }];

  service.createServiceRoleClient.mockReturnValue({ from: (table: string) => makeChain(table) });
  webhook.dispatchWebhookEvent.mockResolvedValue(undefined);
  recovery.scheduleInboundRecovery.mockResolvedValue({ scheduled: 0 });
  recovery.getInboundRecoveryCadenceId.mockImplementation((orgId: string) => (orgId === ORG ? RECOVERY : null));
});

const leadUpdates = () => captured.filter((c) => c.table === 'leads' && c.op === 'update');
const enrollmentUpdates = () => captured.filter((c) => c.table === 'cadence_enrollments' && c.op === 'update');
const interactionInserts = () => captured.filter((c) => c.table === 'interactions' && c.op === 'insert');

describe('pickCadenceEndLossReasonName', () => {
  it('"Nunca respondeu" para cadência comum', () => {
    expect(pickCadenceEndLossReasonName(ORG, 'cad-fria')).toBe('Nunca respondeu');
  });

  it('"Deixou de responder" quando a cadência é a Recovery da org', () => {
    expect(pickCadenceEndLossReasonName(ORG, RECOVERY)).toBe('Deixou de responder');
  });

  it('org sem regra de Recovery sempre usa "Nunca respondeu"', () => {
    expect(pickCadenceEndLossReasonName('outra-org', RECOVERY)).toBe('Nunca respondeu');
  });
});

describe('markLeadLostOnCadenceEnd', () => {
  it('marca o lead como perdido com "Nunca respondeu" ao fim da cadência', async () => {
    const result = await markLeadLostOnCadenceEnd(PARAMS);

    expect(result).toEqual({ lost: true, reasonName: 'Nunca respondeu' });
    expect(reasonFilter).toBe('Nunca respondeu');

    const [leadUpdate] = leadUpdates();
    expect(leadUpdate?.payload).toEqual({
      status: 'unqualified',
      loss_reason_id: REASON_NUNCA.id,
      loss_notes: CADENCE_END_LOSS_NOTES,
    });
    // status revalidado no UPDATE (lead que respondeu no meio não é tocado)
    expect(leadUpdate?.filters).toContain('in:status:["new","contacted"]');
  });

  it('grava o evento de perda na timeline', async () => {
    await markLeadLostOnCadenceEnd(PARAMS);

    const [interaction] = interactionInserts();
    expect(interaction?.payload).toMatchObject({
      org_id: ORG,
      lead_id: 'lead-1',
      cadence_id: 'cad-fria',
      channel: 'system',
      performed_by: null,
      metadata: {
        system_event: 'lead_lost',
        reason: 'cadence_completed_no_reply',
        loss_reason_id: REASON_NUNCA.id,
      },
    });
  });

  it('carimba o motivo no enrollment concluído só se ainda estiver vazio', async () => {
    await markLeadLostOnCadenceEnd(PARAMS);

    const [enrollUpdate] = enrollmentUpdates();
    expect(enrollUpdate?.payload).toEqual({ loss_reason_id: REASON_NUNCA.id, loss_notes: CADENCE_END_LOSS_NOTES });
    expect(enrollUpdate?.payload).not.toHaveProperty('status');
    expect(enrollUpdate?.filters).toContain('eq:id:"enr-1"');
    expect(enrollUpdate?.filters).toContain('is:loss_reason_id:null');
  });

  it('dispara o webhook lead.unqualified e a recuperação de inbound com o motivo', async () => {
    await markLeadLostOnCadenceEnd(PARAMS);

    expect(webhook.dispatchWebhookEvent).toHaveBeenCalledWith(expect.anything(), ORG, 'lead.unqualified', {
      lead_id: 'lead-1',
      loss_reason_id: REASON_NUNCA.id,
      loss_notes: CADENCE_END_LOSS_NOTES,
    });
    expect(recovery.scheduleInboundRecovery).toHaveBeenCalledWith({
      orgId: ORG,
      leadIds: ['lead-1'],
      lossReasonName: 'Nunca respondeu',
      userId: null,
    });
  });

  it('fim da Recovery usa "Deixou de responder"', async () => {
    reasons = [REASON_DEIXOU];

    const result = await markLeadLostOnCadenceEnd({ ...PARAMS, cadenceId: RECOVERY });

    expect(result).toEqual({ lost: true, reasonName: 'Deixou de responder' });
    expect(reasonFilter).toBe('Deixou de responder');
    expect(leadUpdates()[0]?.payload).toMatchObject({ loss_reason_id: REASON_DEIXOU.id });
  });

  it('lead "new" também é perdido', async () => {
    leadStatus = 'new';
    expect(await markLeadLostOnCadenceEnd(PARAMS)).toEqual({ lost: true, reasonName: 'Nunca respondeu' });
  });

  it.each(['qualified', 'won', 'unqualified'])('não mexe em lead com status %s', async (status) => {
    leadStatus = status;

    const result = await markLeadLostOnCadenceEnd(PARAMS);

    expect(result).toEqual({ lost: false, skipped: 'lead_status' });
    expect(captured).toHaveLength(0);
    expect(recovery.scheduleInboundRecovery).not.toHaveBeenCalled();
  });

  it('não mexe em lead apagado/inexistente', async () => {
    leadStatus = null;
    expect(await markLeadLostOnCadenceEnd(PARAMS)).toEqual({ lost: false, skipped: 'lead_status' });
    expect(captured).toHaveLength(0);
  });

  it('não perde lead que ainda está em outra cadência aberta', async () => {
    openEnrollments = [{ id: 'enr-inbound-2' }];

    const result = await markLeadLostOnCadenceEnd(PARAMS);

    expect(result).toEqual({ lost: false, skipped: 'other_open_cadence' });
    expect(captured).toHaveLength(0);
  });

  it('não perde lead com retorno agendado pendente', async () => {
    pendingReturns = [{ id: 'sa-1' }];

    const result = await markLeadLostOnCadenceEnd(PARAMS);

    expect(result).toEqual({ lost: false, skipped: 'scheduled_return' });
    expect(captured).toHaveLength(0);
  });

  it('org sem o motivo cadastrado: não perde e não quebra', async () => {
    reasons = [];

    const result = await markLeadLostOnCadenceEnd(PARAMS);

    expect(result).toEqual({ lost: false, skipped: 'reason_not_found' });
    expect(captured).toHaveLength(0);
  });

  it('status mudou entre a checagem e o UPDATE: não segue com Recovery nem webhook', async () => {
    leadUpdateRows = [];

    const result = await markLeadLostOnCadenceEnd(PARAMS);

    expect(result).toEqual({ lost: false, skipped: 'lead_status' });
    expect(enrollmentUpdates()).toHaveLength(0);
    expect(webhook.dispatchWebhookEvent).not.toHaveBeenCalled();
    expect(recovery.scheduleInboundRecovery).not.toHaveBeenCalled();
  });

  it('nunca lança: erro inesperado vira skipped=error', async () => {
    service.createServiceRoleClient.mockImplementation(() => {
      throw new Error('sem service role');
    });

    expect(await markLeadLostOnCadenceEnd(PARAMS)).toEqual({ lost: false, skipped: 'error' });
  });
});
