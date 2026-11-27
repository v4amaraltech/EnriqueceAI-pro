import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./apply-sdr-call-result', () => ({ applySdrCallResult: vi.fn() }));
vi.mock('./schedule-callback.service', () => ({
  scheduleCallbackActivity: vi.fn(),
  loadPendingReturns: vi.fn(),
  pauseCadencesUntilReturn: vi.fn(),
}));

vi.mock('./redial-supersedes-call.service', () => ({ wasSupersededByRedial: vi.fn() }));

import { applyMergeCallsMetadataRpc, type MergeCallsMetadataArgs } from '@tests/mocks/merge-calls-metadata';

import { applySdrCallResult } from './apply-sdr-call-result';
import { wasSupersededByRedial } from './redial-supersedes-call.service';
import { applyAiCallOutcome, composeAiNotes } from './apply-ai-call-outcome.service';
import type { CallOutcomeClassification } from './call-outcome-classifier';
import { loadPendingReturns, pauseCadencesUntilReturn, scheduleCallbackActivity } from './schedule-callback.service';

const CALL = {
  id: 'call-1',
  org_id: 'org-1',
  lead_id: 'lead-1',
  user_id: 'user-1',
  duration_seconds: 45,
  started_at: '2026-11-05T17:00:00.000Z',
  created_at: '2026-11-05T17:00:00.000Z',
};

/**
 * Fake de `calls`: a linha mora em `state`; a RPC merge_calls_metadata aplica
 * metadata || patch e a guarda de ai_outcome.status (trava pending → processing).
 * `between` simula outro escritor gravando entre o claim e a gravação final.
 */
function fakeCalls(initial: { metadata: Record<string, unknown>; notes?: string | null; sdr_disposition?: string | null }) {
  const state: Record<string, unknown> & { metadata: Record<string, unknown> } = {
    id: CALL.id,
    org_id: CALL.org_id,
    notes: null,
    sdr_disposition: null,
    ...initial,
  };
  const updates: Array<Record<string, unknown>> = [];
  const rpcCalls: MergeCallsMetadataArgs[] = [];
  const client = {
    from() {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.single = () => Promise.resolve({ data: { ...state }, error: null });
      chain.update = (payload: Record<string, unknown>) => {
        updates.push(payload);
        return chain;
      };
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      return chain;
    },
    async rpc(fn: string, args: MergeCallsMetadataArgs) {
      if (fn !== 'merge_calls_metadata') return { data: null, error: { message: `rpc desconhecida: ${fn}` } };
      rpcCalls.push(args);
      return { data: applyMergeCallsMetadataRpc([state], args).data, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, state, updates, rpcCalls };
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
    vi.mocked(loadPendingReturns).mockReset().mockResolvedValue([]);
    vi.mocked(pauseCadencesUntilReturn).mockReset().mockResolvedValue(undefined);
    vi.mocked(wasSupersededByRedial).mockReset().mockResolvedValue(false);
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

  it('claim usa a guarda ai_outcome.status = pending no mesmo UPDATE e manda só ai_outcome', async () => {
    const { client, rpcCalls, updates } = fakeCalls({ metadata: { api4com_call_id: 'a', ai_outcome: { status: 'pending' } } });
    await applyAiCallOutcome(client, CALL, 'alô', { classify: async () => classification(), now: NOW });
    expect(updates).toHaveLength(0);
    expect(rpcCalls[0]).toEqual({
      p_id: CALL.id,
      p_patch: { ai_outcome: { status: 'processing', started_at: NOW().toISOString() } },
      p_only_if_ai_outcome_status: 'pending',
    });
    for (const call of rpcCalls) expect(Object.keys(call.p_patch)).toEqual(['ai_outcome']);
  });

  it('claim perdido (outra execução já mudou para processing no meio): não classifica', async () => {
    const { client, state, rpcCalls } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } } });
    // A leitura vê pending; antes do claim outra execução pega a ligação.
    const rpc = (client as unknown as { rpc: (fn: string, a: MergeCallsMetadataArgs) => Promise<unknown> }).rpc;
    (client as unknown as { rpc: typeof rpc }).rpc = (fn, a) => {
      state.metadata = { ...state.metadata, ai_outcome: { status: 'processing', started_at: 'outro' } };
      return rpc(fn, a);
    };
    const classify = vi.fn();
    expect(await applyAiCallOutcome(client, CALL, 'alô', { classify, now: NOW })).toBeNull();
    expect(classify).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(1);
    expect(state.metadata.ai_outcome).toEqual({ status: 'processing', started_at: 'outro' });
  });

  it('marcador do CRM gravado durante a classificação não é apagado pelo ai_outcome final', async () => {
    const { client, state } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } } });
    const marker = { applied: true, disposition: 'no_answer', rules_version: 'hangup_v1' };
    await applyAiCallOutcome(client, CALL, 'alô', {
      classify: async () => {
        state.metadata = { ...state.metadata, crm_auto_update: marker, audio_stats: { lossPercent: 1 } };
        return classification();
      },
      now: NOW,
    });
    expect(state.metadata).toMatchObject({
      crm_auto_update: marker,
      audio_stats: { lossPercent: 1 },
      ai_outcome: { status: 'done' },
    });
  });

  it('nunca sobrescreve o desfecho do SDR', async () => {
    const { client } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } }, sdr_disposition: 'answered_no_progress' });
    await applyAiCallOutcome(client, CALL, 'alô', { classify: async () => classification(), now: NOW });
    expect(vi.mocked(applySdrCallResult).mock.calls[0]?.[1].sdrOutcome).toBeUndefined();
  });

  it('SDR marca o desfecho DURANTE a classificação: a IA não sobrescreve (leitura fresca)', async () => {
    const { client, state } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } } });
    await applyAiCallOutcome(client, CALL, 'alô', {
      classify: async () => {
        state.sdr_disposition = 'answered_no_progress'; // o SDR clicou enquanto a IA classificava
        return classification();
      },
      now: NOW,
    });
    expect(vi.mocked(applySdrCallResult).mock.calls[0]?.[1].sdrOutcome).toBeUndefined();
  });

  it('SDR escreve a anotação DURANTE a classificação: a IA junta a anotação nova, não a antiga', async () => {
    const { client, state } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } }, notes: 'antiga' });
    await applyAiCallOutcome(client, CALL, 'alô', {
      classify: async () => {
        state.notes = 'ligar pro sócio às 15h'; // o SDR digitou enquanto a IA classificava
        return classification();
      },
      now: NOW,
    });
    expect(vi.mocked(applySdrCallResult).mock.calls[0]?.[1].notes).toContain('Anotação do SDR: ligar pro sócio às 15h');
  });

  it('controle: SDR não marcou nada => a IA aplica o desfecho como hoje', async () => {
    const { client } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } } });
    await applyAiCallOutcome(client, CALL, 'alô', { classify: async () => classification(), now: NOW });
    expect(vi.mocked(applySdrCallResult).mock.calls[0]?.[1].sdrOutcome).toBe('relevant_conversation');
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

  describe('retorno da IA × retorno do SDR (R1)', () => {
    const callbackAi = () =>
      classification({ disposition: 'callback_requested', callback_at: '2026-11-06T18:00:00.000Z', callback_time_from_lead: true });

    it('SDR já registrou o desfecho: a IA NÃO agenda retorno (não sobrescreve o horário do SDR)', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { client, state } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } }, sdr_disposition: 'callback_requested' });
      const out = await applyAiCallOutcome(client, CALL, 'me liga amanhã', { classify: async () => callbackAi(), now: NOW });
      expect(scheduleCallbackActivity).not.toHaveBeenCalled();
      expect(out).toMatchObject({ status: 'done', scheduled_activity_id: null });
      expect(state.metadata.ai_outcome).toMatchObject({ scheduled_activity_id: null });
    });

    it('SDR marca o desfecho DURANTE a classificação (leitura fresca): a IA também não agenda', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { client, state } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } } });
      await applyAiCallOutcome(client, CALL, 'me liga amanhã', {
        classify: async () => {
          state.sdr_disposition = 'callback_requested'; // o SDR clicou enquanto a IA classificava
          return callbackAi();
        },
        now: NOW,
      });
      expect(scheduleCallbackActivity).not.toHaveBeenCalled();
    });

    it('controle: SDR sem desfecho => a IA agenda como sempre', async () => {
      const { client } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } }, sdr_disposition: null });
      const out = await applyAiCallOutcome(client, CALL, 'me liga amanhã', { classify: async () => callbackAi(), now: NOW });
      expect(scheduleCallbackActivity).toHaveBeenCalledTimes(1);
      expect(out).toMatchObject({ scheduled_activity_id: 'sched-1' });
    });
  });

  describe('data já marcada × IA', () => {
    // Ligação em 05/11 14:00 BRT (17:00Z); agora 17:05Z.
    const OLD = { id: 'sa-old', scheduled_at: '2026-11-12T14:00:00.000Z', created_at: '2026-11-03T12:00:00.000Z' };
    const AI_AT = '2026-11-06T12:00:00.000Z';

    async function run(timeFromLead: boolean) {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { client } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } } });
      return applyAiCallOutcome(client, CALL, 'me liga depois', {
        classify: async () =>
          classification({ disposition: 'callback_requested', callback_at: AI_AT, callback_time_from_lead: timeFromLead }),
        now: NOW,
      });
    }

    it('sem data dita pelo lead: mantém o retorno futuro e pausa a cadência por ele', async () => {
      vi.mocked(loadPendingReturns).mockResolvedValue([OLD]);
      const out = await run(false);
      expect(scheduleCallbackActivity).not.toHaveBeenCalled();
      expect(out).toMatchObject({ status: 'done', disposition: 'callback_requested', scheduled_activity_id: 'sa-old', callback_at: OLD.scheduled_at, needs_review: false });
      expect(vi.mocked(pauseCadencesUntilReturn).mock.calls[0]?.[1]).toMatchObject({ leadId: 'lead-1', scheduledAt: OLD.scheduled_at, scheduledActivityId: 'sa-old' });
      expect(applySdrCallResult).toHaveBeenCalledTimes(1);
    });

    it('com data dita pelo lead: substitui o retorno antigo', async () => {
      vi.mocked(loadPendingReturns).mockResolvedValue([OLD]);
      expect(await run(true)).toMatchObject({ scheduled_activity_id: 'sched-1', callback_at: AI_AT });
      expect(vi.mocked(scheduleCallbackActivity).mock.calls[0]?.[1]).toMatchObject({ scheduledAt: AI_AT });
    });

    it('marcado depois do início da ligação: fica o do SDR, mesmo com data dita', async () => {
      vi.mocked(loadPendingReturns).mockResolvedValue([OLD, { ...OLD, id: 'sa-sdr', created_at: '2026-11-05T17:02:00.000Z' }]);
      expect(await run(true)).toMatchObject({ scheduled_activity_id: 'sa-sdr' });
      expect(scheduleCallbackActivity).not.toHaveBeenCalled();
    });

    it.each([
      ['sem retorno', []],
      ['só um vencido', [{ ...OLD, scheduled_at: '2026-11-04T12:00:00.000Z' }]],
    ])('%s: a IA agenda como antes', async (_n, pending) => {
      vi.mocked(loadPendingReturns).mockResolvedValue(pending);
      expect(await run(false)).toMatchObject({ scheduled_activity_id: 'sched-1' });
      expect(pauseCadencesUntilReturn).not.toHaveBeenCalled();
    });

    it('falha ao ler o retorno existente: não cria nem cancela, marca para revisar', async () => {
      vi.mocked(loadPendingReturns).mockResolvedValue(null);
      const out = await run(false);
      expect(scheduleCallbackActivity).not.toHaveBeenCalled();
      expect(out).toMatchObject({ needs_review: true, scheduled_activity_id: null, error: 'callback_existing_check_failed' });
    });
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

  describe('ligação que caiu e foi religada', () => {
    const callbackResult = () =>
      vi.fn().mockResolvedValue(
        classification({ disposition: 'callback_requested', callback_at: '2026-11-06T12:00:00.000Z', callback_time_from_lead: true }),
      );
    const run = async () => {
      const { client } = fakeCalls({ metadata: { ai_outcome: { status: 'pending' } } });
      return applyAiCallOutcome(client, CALL, 'texto', { classify: callbackResult(), now: NOW });
    };

    it('religação assumiu: não cria, não cancela, não pausa; desfecho e resumo seguem', async () => {
      vi.mocked(wasSupersededByRedial).mockResolvedValue(true);
      const outcome = await run();
      expect(scheduleCallbackActivity).not.toHaveBeenCalled();
      expect(pauseCadencesUntilReturn).not.toHaveBeenCalled();
      expect(loadPendingReturns).not.toHaveBeenCalled();
      expect(applySdrCallResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sdrOutcome: 'callback_requested' }));
      expect(outcome).toMatchObject({ status: 'done', callback_at: null, scheduled_activity_id: null, needs_review: false });
    });

    it('falha ao conferir: nada é criado nem cancelado e fica para revisar', async () => {
      vi.mocked(wasSupersededByRedial).mockResolvedValue(null);
      const outcome = await run();
      expect(scheduleCallbackActivity).not.toHaveBeenCalled();
      expect(pauseCadencesUntilReturn).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ needs_review: true, error: 'callback_redial_check_failed' });
    });

    it('sem religação que assumiu: agenda como antes', async () => {
      const outcome = await run();
      expect(wasSupersededByRedial).toHaveBeenCalledWith(
        expect.anything(),
        { id: CALL.id, org_id: CALL.org_id, lead_id: 'lead-1', created_at: CALL.created_at },
        NOW(),
      );
      expect(scheduleCallbackActivity).toHaveBeenCalledTimes(1);
      expect(outcome).toMatchObject({ scheduled_activity_id: 'sched-1' });
    });
  });
});

describe('composeAiNotes', () => {
  it('sem anotação do SDR → só o resumo', () => {
    expect(composeAiNotes('Caixa postal.', '  ')).toBe('Resumo da IA: Caixa postal.');
  });
});
