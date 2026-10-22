import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const webhook = vi.hoisted(() => ({ dispatchWebhookEvent: vi.fn(() => Promise.resolve()) }));
vi.mock('@/features/cadences/services/webhook-dispatch.service', () => webhook);

import { completeDialerCall } from './complete-dialer-call';

const CALL_ID = '6f1c2a3e-0000-4000-8000-000000000010';
const ENROLLMENT = '6f1c2a3e-0000-4000-8000-000000000011';
const CADENCE = '6f1c2a3e-0000-4000-8000-000000000012';
const STEP = '6f1c2a3e-0000-4000-8000-000000000013';
const LEAD = '6f1c2a3e-0000-4000-8000-000000000014';

type Op = { table: string; op: 'insert' | 'update'; payload: Record<string, unknown> };

/** Supabase falso que registra inserts/updates por tabela. */
function fakeSupabase(rows: {
  call?: Record<string, unknown> | null;
  interaction?: Record<string, unknown> | null;
  stepOrder?: number;
  nextStepOrder?: number | null;
}) {
  const ops: Op[] = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'gt', 'order', 'limit', 'contains']) chain[m] = () => chain;
      chain.single = () => {
        if (table === 'calls') return Promise.resolve({ data: rows.call ?? null, error: null });
        if (table === 'cadence_steps') return Promise.resolve({ data: { step_order: rows.stepOrder ?? 2 }, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      chain.maybeSingle = () => {
        if (table === 'interactions') return Promise.resolve({ data: rows.interaction ?? null, error: null });
        if (table === 'cadence_steps') {
          const next = rows.nextStepOrder === undefined ? 3 : rows.nextStepOrder;
          return Promise.resolve({ data: next === null ? null : { step_order: next }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      chain.insert = (payload: Record<string, unknown>) => {
        ops.push({ table, op: 'insert', payload });
        const ins: Record<string, unknown> = {
          select: () => ins,
          single: () => Promise.resolve({ data: { id: 'legacy-call' }, error: null }),
          then: (r: (v: unknown) => void) => r({ error: null }),
        };
        return ins;
      };
      chain.update = (payload: Record<string, unknown>) => {
        ops.push({ table, op: 'update', payload });
        const upd: Record<string, unknown> = { eq: () => upd, then: (r: (v: unknown) => void) => r({ error: null }) };
        return upd;
      };
      return chain;
    },
  };
  return { client, ops };
}

const base = {
  enrollmentId: ENROLLMENT,
  cadenceId: CADENCE,
  stepId: STEP,
  leadId: LEAD,
  phone: '(16) 98250-1819',
  notes: '',
  durationSeconds: 0,
};

describe('completeDialerCall', () => {
  beforeEach(() => {
    auth.getAuthOrgIdResult.mockReset();
    webhook.dispatchWebhookEvent.mockClear();
  });

  it('com callId: grava na linha existente — NENHUM insert em calls nem em interactions', async () => {
    const { client, ops } = fakeSupabase({
      call: { id: CALL_ID, duration_seconds: 0, lead_id: LEAD, org_id: 'org', hangup_cause: 'NUMBER_CHANGED' },
      interaction: { id: 'int-1', metadata: { callId: CALL_ID, source: 'internal_api4com' }, message_content: 'Ligação iniciada' },
    });
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org', userId: 'u1', supabase: client } });

    const r = await completeDialerCall({ ...base, callId: CALL_ID, sdrOutcome: 'no_answer', notes: 'caixa postal' });

    expect(r).toEqual({ success: true, data: { callId: CALL_ID } });
    expect(ops.filter((o) => o.op === 'insert')).toEqual([]);
    const callUpdate = ops.find((o) => o.table === 'calls' && o.op === 'update');
    expect(callUpdate?.payload).toMatchObject({ sdr_disposition: 'no_answer', notes: 'caixa postal' });
    expect(callUpdate?.payload).not.toHaveProperty('status');
    expect(callUpdate?.payload).not.toHaveProperty('duration_seconds');
    const intUpdate = ops.find((o) => o.table === 'interactions' && o.op === 'update');
    expect(intUpdate?.payload).toMatchObject({ cadence_id: CADENCE, step_id: STEP, metadata: expect.objectContaining({ classified_via: 'power_dialer' }) });
    expect(webhook.dispatchWebhookEvent).toHaveBeenCalledWith(client, 'org', 'call.completed', expect.objectContaining({ call_id: CALL_ID }));
  });

  it('com callId: avança a cadência uma etapa', async () => {
    const { client, ops } = fakeSupabase({
      call: { id: CALL_ID, duration_seconds: 0, lead_id: LEAD, org_id: 'org', hangup_cause: 'NUMBER_CHANGED' },
      interaction: { id: 'int-1', metadata: { callId: CALL_ID }, message_content: 'x' },
      stepOrder: 2,
      nextStepOrder: 3,
    });
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org', userId: 'u1', supabase: client } });

    await completeDialerCall({ ...base, callId: CALL_ID, sdrOutcome: 'no_answer' });

    expect(ops.find((o) => o.table === 'cadence_enrollments')?.payload).toEqual({ current_step: 3 });
  });

  it('com callId de outra org (linha não encontrada) → erro e cadência intocada', async () => {
    const { client, ops } = fakeSupabase({ call: null });
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org', userId: 'u1', supabase: client } });

    const r = await completeDialerCall({ ...base, callId: CALL_ID });

    expect(r).toEqual({ success: false, error: 'Ligação não encontrada' });
    expect(ops.find((o) => o.table === 'cadence_enrollments')).toBeUndefined();
  });

  it('sem callId (caminho antigo) continua criando a linha', async () => {
    const { client, ops } = fakeSupabase({});
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org', userId: 'u1', supabase: client } });

    const r = await completeDialerCall(base);

    expect(r).toEqual({ success: true, data: { callId: 'legacy-call' } });
    expect(ops.find((o) => o.table === 'calls' && o.op === 'insert')?.payload).toMatchObject({ origin: 'power_dialer' });
  });
});
