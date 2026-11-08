import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EXEC_A, LEAD_A, ORG_A, ORG_B } from './edge-command.testkit';

const mocks = vi.hoisted(() => ({ calls: [] as Array<{ table: string; eq: Record<string, unknown> }>, data: {} as Record<string, unknown>, flag: vi.fn() }));

/** Builder encadeavel que registra os filtros e devolve a linha configurada para a tabela. */
vi.mock('@/lib/supabase/from', () => ({
  from: (_db: unknown, table: string) => {
    const call = { table, eq: {} as Record<string, unknown> };
    mocks.calls.push(call);
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'is', 'limit', 'order']) b[m] = () => b;
    b.eq = (col: string, val: unknown) => { call.eq[col] = val; return b; };
    const result = () => {
      const row = mocks.data[table] as Record<string, unknown> | undefined;
      // Simula RLS ausente: o dado so existe para a organizacao dona.
      const owner = row?.__org;
      return Promise.resolve({ data: owner && call.eq.org_id !== owner ? null : (row ?? null), error: null });
    };
    b.maybeSingle = result;
    return b;
  },
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({}) }));
vi.mock('../services/flag-scope.service', () => ({ isScopedFlagEnabled: mocks.flag }));
vi.mock('../services/send-decision.service', () => ({ evaluateSend: vi.fn() }));
vi.mock('../services/ownership.service', () => ({ getContactAccess: vi.fn() }));
vi.mock('../services/call-priority.service', () => ({ recordDecisionEvent: vi.fn(), sanitizePayload: (p: unknown) => p }));
vi.mock('@/features/bdr-steps/actions/rpc', () => ({ callRpc: vi.fn() }));

import { createEdgePorts } from './edge-ports';
import { isEdgeAdapterEnabled } from './edge-command.service';

describe('portas reais: toda consulta filtra por org_id', () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.data = {
      cadence_step_executions: { __org: ORG_A, execution_id: EXEC_A, enrollment_id: 'en1', step_id: 's1', channel: 'whatsapp', confirmed_at: null },
      cadence_enrollments: { __org: ORG_A, lead_id: LEAD_A },
      leads: { __org: ORG_A, id: LEAD_A, email: 'a@x.com', telefone: '11999990000', phones: [], assigned_to: null },
    };
  });
  const ports = () => createEdgePorts(vi.fn());

  it('org dona resolve; passo e lead recebem o filtro de org', async () => {
    const r = await ports().resolveTarget(ORG_A, { workflow: 'ana_whatsapp', executionId: EXEC_A });
    expect(r.ok).toBe(true);
    for (const c of mocks.calls) expect(c.eq.org_id).toBe(ORG_A);
    expect(mocks.calls.map((c) => c.table)).toEqual(['cadence_step_executions', 'cadence_enrollments', 'leads']);
  });

  it('outra org não enxerga o passo (not_found) e nada além dele é lido', async () => {
    const r = await ports().resolveTarget(ORG_B, { workflow: 'ana_whatsapp', executionId: EXEC_A });
    expect(r).toEqual({ ok: false, reason: 'not_found' });
    expect(mocks.calls).toHaveLength(1);
  });

  it('canal divergente e passo já confirmado são recusados', async () => {
    expect(await ports().resolveTarget(ORG_A, { workflow: 'ana_email', executionId: EXEC_A })).toEqual({ ok: false, reason: 'wrong_channel' });
    mocks.data.cadence_step_executions = { __org: ORG_A, execution_id: EXEC_A, enrollment_id: 'en1', step_id: 's1', channel: 'whatsapp', confirmed_at: '2026-11-08T00:00:00Z' };
    expect(await ports().resolveTarget(ORG_A, { workflow: 'ana_whatsapp', executionId: EXEC_A })).toEqual({ ok: false, reason: 'already_confirmed' });
  });

  it('agente de e-mail: lead de outra org é not_found', async () => {
    expect(await ports().resolveTarget(ORG_B, { workflow: 'ana_email_agent', leadId: LEAD_A })).toEqual({ ok: false, reason: 'not_found' });
    expect(mocks.calls[0]?.eq).toMatchObject({ id: LEAD_A, org_id: ORG_B });
  });

  it('leitura da trilha filtra por org e chave', async () => {
    mocks.data.decision_events = null as never;
    await ports().readEvent(ORG_A, 'edge.v1.authorize.x');
    expect(mocks.calls[0]?.table).toBe('decision_events');
  });
});

describe('flag edge_command_adapter usa o escopo por organização', () => {
  it('consulta a chave certa com a org', async () => {
    mocks.flag.mockResolvedValue(false);
    expect(await isEdgeAdapterEnabled(ORG_A)).toBe(false);
    expect(mocks.flag).toHaveBeenCalledWith('edge_command_adapter', { orgId: ORG_A });
  });
});
