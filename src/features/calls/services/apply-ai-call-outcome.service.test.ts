import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./apply-sdr-call-result', () => ({ applySdrCallResult: vi.fn() }));
vi.mock('./schedule-callback.service', () => ({ scheduleCallbackActivity: vi.fn() }));

import { applySdrCallResult } from './apply-sdr-call-result';
import { applyAiCallOutcome, composeAiNotes } from './apply-ai-call-outcome.service';
import type { CallOutcomeClassification } from './call-outcome-classifier';
import { scheduleCallbackActivity } from './schedule-callback.service';

const CALL = {
  id: 'call-1',
  org_id: 'org-1',
  lead_id: 'lead-1',
  user_id: 'user-1',
  duration_seconds: 45,
  started_at: '2026-11-05T17:00:00.000Z',
  created_at: '2026-11-05T17:00:00.000Z',
};

/** Fake de `calls`: guarda o metadata e simula a trava pending → processing. */
function fakeCalls(initial: { metadata: Record<string, unknown>; notes?: string | null; sdr_disposition?: string | null }) {
  const state = { notes: null, sdr_disposition: null, ...initial };
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    from() {
      const filters: Array<[string, unknown]> = [];
      let pending: Record<string, unknown> | null = null;
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      };
      chain.single = () => Promise.resolve({ data: { ...state }, error: null });
      chain.update = (payload: Record<string, unknown>) => {
        pending = payload;
        return chain;
      };
      const run = () => {
        if (!pending) return { data: null, error: null };
        const needsPending = filters.some(([c, v]) => c === 'metadata->ai_outcome->>status' && v === 'pending');
        const current = (state.metadata.ai_outcome as { status?: string } | undefined)?.status;
        if (needsPending && current !== 'pending') return { data: [], error: null };
        updates.push(pending);
        if (pending.metadata) state.metadata = pending.metadata as Record<string, unknown>;
        return { data: [{ id: CALL.id }], error: null };
      };
      chain.then = (resolve: (v: unknown) => void) => resolve(run());
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, state, updates };
}

function classification(over: Partial<CallOutcomeClassification> = {}): CallOutcomeClassification {
  return {
    disposition: 'relevant_conversation',
    confidence: 0.9,
    summary: 'Falou com o dono, quer proposta.',
    callback_at: null,
    callback_time_from_lead: false,
    needs_review: false,
    model: 'openai/gpt-4.1',
    ...over,
  };
}

const NOW = () => new Date('2026-11-05T17:05:00.000Z');

describe('applyAiCallOutcome', () => {
  beforeEach(() => {
    vi.mocked(applySdrCallResult).mockReset().mockResolvedValue({ success: true, data: { callId: CALL.id, leadId: 'lead-1', notesApplied: true } });
    vi.mocked(scheduleCallbackActivity).mockReset().mockResolvedValue({ id: 'sched-1' });
  });

  it('sem ai_outcome pendente → não faz nada', async () => {
    const { client } = fakeCalls({ metadata: { api4com_call_id: 'a' } });
    const classify = vi.fn();
    expect(await applyAiCallOutcome(client, CALL, 'alô', { classify, now: NOW })).toBeNull();
    expect(classify).not.toHaveBeenCalled();
  });

  it('aplica resultado, junta anotação do SDR e preserva o metadata', async () => {
    const { client, state } = fakeCalls({ metadata: { api4com_call_id: 'a', ai_outcome: { status: 'pending' } }, notes: 'ligar pro sócio' });
    const out = await applyAiCallOutcome(client, CALL, 'alô', { classify: async () => classification(), now: NOW });

    expect(out).toMatchObject({ status: 'done', disposition: 'relevant_conversation', needs_review: false });
    expect(vi.mocked(applySdrCallResult).mock.calls[0]?.[1]).toMatchObject({
      callId: 'call-1',
      sdrOutcome: 'relevant_conversation',
      notes: 'Resumo da IA: Falou com o dono, quer proposta.\n\nAnotação do SDR: ligar pro sócio',
    });
    expect(state.metadata).toMatchObject({ api4com_call_id: 'a', ai_outcome: { status: 'done', model: 'openai/gpt-4.1' } });
  });

  it('nunca sobrescreve o desfecho do SDR', async () => {
    const { client } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } }, sdr_disposition: 'answered_no_progress' });
    await applyAiCallOutcome(client, CALL, 'alô', { classify: async () => classification(), now: NOW });
    expect(vi.mocked(applySdrCallResult).mock.calls[0]?.[1].sdrOutcome).toBeUndefined();
  });

  it('falha da IA → failed + Revisar, sem aplicar nada', async () => {
    const { client, state } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } } });
    const out = await applyAiCallOutcome(client, CALL, 'alô', {
      classify: async () => {
        throw new Error('classifier_invalid_json: x');
      },
      now: NOW,
    });
    expect(out).toMatchObject({ status: 'failed', needs_review: true });
    expect(state.metadata.ai_outcome).toMatchObject({ status: 'failed', needs_review: true });
    expect(applySdrCallResult).not.toHaveBeenCalled();
  });

  it('confiança baixa → Revisar', async () => {
    const { client } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } } });
    const out = await applyAiCallOutcome(client, CALL, 'alô', {
      classify: async () => classification({ confidence: 0.5, needs_review: true }),
      now: NOW,
    });
    expect(out?.needs_review).toBe(true);
  });

  it('callback_requested → agenda retorno por telefone para o SDR da ligação', async () => {
    const { client, state } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } } });
    await applyAiCallOutcome(client, CALL, 'me liga amanhã', {
      classify: async () =>
        classification({ disposition: 'callback_requested', callback_at: '2026-11-06T18:00:00.000Z', callback_time_from_lead: true }),
      now: NOW,
    });
    expect(vi.mocked(scheduleCallbackActivity).mock.calls[0]?.[1]).toMatchObject({
      orgId: 'org-1',
      leadId: 'lead-1',
      userId: 'user-1',
      scheduledAt: '2026-11-06T18:00:00.000Z',
    });
    expect(state.metadata.ai_outcome).toMatchObject({ scheduled_activity_id: 'sched-1', callback_at: '2026-11-06T18:00:00.000Z' });
  });

  it('outra execução já pegou (não está mais pending) → não classifica de novo', async () => {
    const { client } = fakeCalls({ metadata: { ai_outcome: { status: 'processing' } } });
    const classify = vi.fn();
    expect(await applyAiCallOutcome(client, CALL, 'alô', { classify, now: NOW })).toBeNull();
    expect(classify).not.toHaveBeenCalled();
  });

  describe('retenção por baixa confiança (cockpit, hold_low_confidence)', () => {
    const armed = { ai_outcome: { status: 'pending', hold_low_confidence: true } };

    it('baixa confiança armada: não aplica desfecho, notas nem retorno; vira exceção revisável', async () => {
      const { client, state } = fakeCalls({ metadata: armed });
      const out = await applyAiCallOutcome(client, CALL, 'alô', {
        classify: async () =>
          classification({ disposition: 'callback_requested', callback_at: '2026-11-06T18:00:00.000Z', confidence: 0.4, needs_review: true }),
        now: NOW,
      });
      expect(out).toMatchObject({ status: 'done', needs_review: true, applied: false, scheduled_activity_id: null, confidence: 0.4 });
      expect(applySdrCallResult).not.toHaveBeenCalled();
      expect(scheduleCallbackActivity).not.toHaveBeenCalled();
      expect(state.metadata.ai_outcome).toMatchObject({ status: 'done', applied: false });
    });

    it('alta confiança armada: aplica normalmente', async () => {
      const { client } = fakeCalls({ metadata: armed });
      const out = await applyAiCallOutcome(client, CALL, 'alô', { classify: async () => classification(), now: NOW });
      expect(out).toMatchObject({ status: 'done', needs_review: false });
      expect(out?.applied).toBeUndefined();
      expect(applySdrCallResult).toHaveBeenCalledTimes(1);
    });

    it('flag desligada (sem marcador): baixa confiança continua sendo aplicada com selo Revisar, como antes', async () => {
      const { client } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } } });
      const out = await applyAiCallOutcome(client, CALL, 'alô', {
        classify: async () => classification({ confidence: 0.4, needs_review: true }),
        now: NOW,
      });
      expect(out?.needs_review).toBe(true);
      expect(out?.applied).toBeUndefined();
      expect(applySdrCallResult).toHaveBeenCalledTimes(1);
    });

    it('callback repetido (replay) não classifica nem aplica duas vezes', async () => {
      const { client } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } } });
      const classify = vi.fn(async () =>
        classification({ disposition: 'callback_requested', callback_at: '2026-11-06T18:00:00.000Z', callback_time_from_lead: true }),
      );
      const first = await applyAiCallOutcome(client, CALL, 'alô', { classify, now: NOW });
      const second = await applyAiCallOutcome(client, CALL, 'alô', { classify, now: NOW });
      expect(first?.status).toBe('done');
      expect(second).toBeNull();
      expect(classify).toHaveBeenCalledTimes(1);
      expect(applySdrCallResult).toHaveBeenCalledTimes(1);
      expect(scheduleCallbackActivity).toHaveBeenCalledTimes(1);
    });
  });
});

describe('composeAiNotes', () => {
  it('sem anotação do SDR → só o resumo', () => {
    expect(composeAiNotes('Caixa postal.', '  ')).toBe('Resumo da IA: Caixa postal.');
  });
});
