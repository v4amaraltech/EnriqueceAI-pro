import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
const leadEvents = vi.hoisted(() => ({ logLeadEvent: vi.fn() }));
const service = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));

vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('@/lib/supabase/service', () => service);
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/features/leads/actions/log-lead-event', () => leadEvents);
vi.mock('@/features/integrations/services/calendar.service', () => ({
  getCalendarConnection: vi.fn().mockResolvedValue(null),
  createCalendarEvent: vi.fn(),
}));

interface Call {
  table: string;
  ops: Array<[string, unknown[]]>;
}

/** Cliente fake que registra a cadeia de cada chamada e responde por tabela/operação. */
function makeClient(respond: (call: Call) => unknown) {
  const calls: Call[] = [];
  const client = {
    calls,
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const m of ['insert', 'update', 'select', 'eq', 'neq', 'in', 'lt']) {
        chain[m] = (...args: unknown[]) => {
          call.ops.push([m, args]);
          return chain;
        };
      }
      chain.single = () => Promise.resolve(respond(call));
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(respond(call)).then(resolve);
      return chain;
    },
  };
  return client;
}

const has = (call: Call, op: string, ...args: unknown[]) =>
  call.ops.some(([o, a]) => o === op && JSON.stringify(a) === JSON.stringify(args));
const updatePayload = (call: Call) => call.ops.find(([o]) => o === 'update')?.[1][0] as Record<string, unknown>;

import { scheduleActivity } from './schedule-activity';

const LEAD = '11111111-1111-1111-1111-111111111111';
const ENR = '22222222-2222-2222-2222-222222222222';
const STEP = '33333333-3333-3333-3333-333333333333';
const RETURN_AT = '2026-10-20T12:00:00.000Z'; // ter 9h BRT
const RESUME_AT = '2026-10-21T12:00:00.000Z'; // qua 9h BRT

let userClient: ReturnType<typeof makeClient>;
let serviceClient: ReturnType<typeof makeClient>;
let pausedRows: Array<{ id: string; cadence_id: string }>;
let extendedRows: Array<{ id: string; cadence_id: string }>;

describe('scheduleActivity — pausa a cadência até o retorno', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pausedRows = [{ id: ENR, cadence_id: 'cad-1' }];
    extendedRows = [];
    userClient = makeClient((call) =>
      call.table === 'scheduled_activities' ? { data: { id: 'sa-1' }, error: null } : { data: null, error: null },
    );
    serviceClient = makeClient((call) => {
      if (call.table !== 'cadence_enrollments') return { data: null, error: null };
      if (has(call, 'eq', 'status', 'active')) return { data: pausedRows, error: null };
      if (has(call, 'eq', 'status', 'paused')) return { data: extendedRows, error: null };
      return { data: null, error: null };
    });
    service.createServiceRoleClient.mockReturnValue(serviceClient);
    auth.getAuthOrgIdResult.mockResolvedValue({
      success: true,
      data: { orgId: 'org-1', userId: 'u1', supabase: userClient },
    });
  });

  const enrollmentCalls = () => serviceClient.calls.filter((c) => c.table === 'cadence_enrollments');

  it('sem a flag, não mexe na cadência (comportamento antigo)', async () => {
    const r = await scheduleActivity({ leadId: LEAD, channel: 'phone', scheduledAt: RETURN_AT });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.cadencePausedUntil).toBeUndefined();
    expect(enrollmentCalls()).toHaveLength(0);
    expect(userClient.rpc).not.toHaveBeenCalled();
  });

  it('pausa as inscrições ativas do lead até o dia útil seguinte ao retorno', async () => {
    const r = await scheduleActivity({
      leadId: LEAD, channel: 'phone', scheduledAt: RETURN_AT, pauseCadenceUntilReturn: true,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.cadencePausedUntil).toBe(RESUME_AT);

    const pause = enrollmentCalls().find((c) => has(c, 'eq', 'status', 'active'))!;
    expect(updatePayload(pause)).toEqual({ status: 'paused', scheduled_start_at: RESUME_AT });
    expect(has(pause, 'eq', 'org_id', 'org-1')).toBe(true);
    expect(has(pause, 'eq', 'lead_id', LEAD)).toBe(true);

    expect(leadEvents.logLeadEvent).toHaveBeenCalledWith(
      userClient,
      expect.objectContaining({
        event: 'cadence_paused_for_return',
        message: 'Cadência pausada até 21/10/2026 — retorno combinado com o lead em 20/10/2026, 09:00',
        metadata: expect.objectContaining({ cadence_id: 'cad-1', resume_at: RESUME_AT, scheduled_activity_id: 'sa-1' }),
      }),
    );
  });

  it('só empurra para frente uma retomada já agendada, nunca encurta', async () => {
    pausedRows = [];
    extendedRows = [{ id: ENR, cadence_id: 'cad-1' }];
    const r = await scheduleActivity({
      leadId: LEAD, channel: 'phone', scheduledAt: RETURN_AT, pauseCadenceUntilReturn: true,
    });
    if (r.success) expect(r.data.cadencePausedUntil).toBe(RESUME_AT);
    const extend = enrollmentCalls().find((c) => has(c, 'eq', 'status', 'paused'))!;
    expect(updatePayload(extend)).toEqual({ scheduled_start_at: RESUME_AT });
    expect(has(extend, 'lt', 'scheduled_start_at', RESUME_AT)).toBe(true);
  });

  it('avança o passo da ligação ANTES de pausar', async () => {
    await scheduleActivity({
      leadId: LEAD, channel: 'phone', scheduledAt: RETURN_AT, pauseCadenceUntilReturn: true,
      executedStep: { enrollmentId: ENR, stepId: STEP },
    });
    expect(userClient.rpc).toHaveBeenCalledWith('advance_enrollment_after_step', {
      p_enrollment_id: ENR, p_executed_step_id: STEP, p_performed_by: 'u1',
    });
  });

  it('sem cadência ativa, não registra pausa na timeline', async () => {
    pausedRows = [];
    const r = await scheduleActivity({
      leadId: LEAD, channel: 'phone', scheduledAt: RETURN_AT, pauseCadenceUntilReturn: true,
    });
    if (r.success) expect(r.data.cadencePausedUntil).toBeUndefined();
    expect(leadEvents.logLeadEvent).not.toHaveBeenCalled();
  });

  it('mostra o horário do retorno em BRT na timeline', async () => {
    await scheduleActivity({ leadId: LEAD, channel: 'phone', scheduledAt: RETURN_AT });
    const timeline = userClient.calls.find((c) => c.table === 'interactions')!;
    const row = timeline.ops.find(([o]) => o === 'insert')![1][0] as { message_content: string };
    expect(row.message_content).toBe('Atividade agendada: Ligação para 20/10/2026, 09:00');
  });
});
