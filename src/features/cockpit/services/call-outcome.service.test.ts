import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { armCockpitCallOutcome, fetchCockpitCallOutcome } from './call-outcome.service';

type Row = Record<string, unknown>;

function fakeSupabase(tables: { calls: Row | null; leads?: Row | null }) {
  const updates: Row[] = [];
  const filters: Array<[string, string, unknown]> = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (c: string, v: unknown) => {
        filters.push([table, c, v]);
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve({ data: table === 'calls' ? tables.calls : (tables.leads ?? null), error: null });
      chain.update = (payload: Row) => {
        updates.push(payload);
        if (tables.calls) Object.assign(tables.calls, payload);
        return chain;
      };
      chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, updates, filters };
}

const CALL_ID = 'call-1';
const baseCall = (over: Row = {}): Row => ({
  id: CALL_ID,
  user_id: 'u1',
  lead_id: 'lead-1',
  answered_at: '2026-11-07T12:00:05Z',
  hangup_cause: 'NORMAL_CLEARING',
  duration_seconds: 60,
  sdr_disposition: null,
  notes: null,
  transcription_status: 'processing',
  metadata: { api4com_call_id: 'x' },
  ...over,
});
const sdr = { orgId: 'org-1', userId: 'u1', isManager: false };

describe('armCockpitCallOutcome', () => {
  it('arma uma vez, preserva o metadata e marca retenção por baixa confiança', async () => {
    const f = fakeSupabase({ calls: baseCall() });
    const r = await armCockpitCallOutcome(f.client, sdr, CALL_ID, new Date('2026-11-07T12:01:00Z'));
    expect(r.status).toBe('armed');
    expect(f.updates[0]?.metadata).toMatchObject({
      api4com_call_id: 'x',
      ai_outcome: { status: 'pending', hold_low_confidence: true },
    });
    expect(f.filters).toContainEqual(['calls', 'org_id', 'org-1']);
  });

  it('chamada repetida (replay do clique/callback) não escreve de novo', async () => {
    const f = fakeSupabase({ calls: baseCall() });
    await armCockpitCallOutcome(f.client, sdr, CALL_ID);
    const second = await armCockpitCallOutcome(f.client, sdr, CALL_ID);
    expect(second.status).toBe('already_armed');
    expect(f.updates).toHaveLength(1);
  });

  it('não rearma ligação cujo resultado a IA já concluiu', async () => {
    const f = fakeSupabase({ calls: baseCall({ metadata: { ai_outcome: { status: 'done' } } }) });
    expect((await armCockpitCallOutcome(f.client, sdr, CALL_ID)).status).toBe('already_armed');
    expect(f.updates).toHaveLength(0);
  });

  it('ligação de outro usuário fora da carteira: não encontrada e nada é escrito', async () => {
    const f = fakeSupabase({ calls: baseCall({ user_id: 'outro' }), leads: { assigned_to: 'x', closer_id: 'y' } });
    expect((await armCockpitCallOutcome(f.client, sdr, CALL_ID)).status).toBe('not_found');
    expect(f.updates).toHaveLength(0);
  });

  it('closer da carteira pode armar ligação de outro usuário', async () => {
    const f = fakeSupabase({ calls: baseCall({ user_id: 'outro' }), leads: { assigned_to: 'x', closer_id: 'u1' } });
    expect((await armCockpitCallOutcome(f.client, sdr, CALL_ID)).status).toBe('armed');
  });
});

describe('fetchCockpitCallOutcome', () => {
  it('transcrição pendente: devolve pendente e a leitura não escreve nada', async () => {
    const f = fakeSupabase({ calls: baseCall({ metadata: { ai_outcome: { status: 'pending' } } }) });
    const r = await fetchCockpitCallOutcome(f.client, sdr, CALL_ID);
    expect(r).toEqual({ status: 'ok', outcome: { state: 'pending', stage: 'transcription' } });
    expect(f.updates).toHaveLength(0);
  });

  it('leituras repetidas do mesmo resultado confirmado são idênticas e não escrevem', async () => {
    const f = fakeSupabase({
      calls: baseCall({ metadata: { ai_outcome: { status: 'done', disposition: 'voicemail', confidence: 0.9, summary: 'Caixa', needs_review: false } } }),
    });
    const a = await fetchCockpitCallOutcome(f.client, sdr, CALL_ID);
    const b = await fetchCockpitCallOutcome(f.client, sdr, CALL_ID);
    expect(a).toEqual(b);
    expect(f.updates).toHaveLength(0);
  });

  it('baixa confiança vira exceção', async () => {
    const f = fakeSupabase({
      calls: baseCall({ metadata: { ai_outcome: { status: 'done', disposition: 'relevant_conversation', confidence: 0.3, applied: false, needs_review: true } } }),
    });
    const r = await fetchCockpitCallOutcome(f.client, sdr, CALL_ID);
    expect(r).toMatchObject({ status: 'ok', outcome: { state: 'exception', reason: 'low_confidence' } });
  });

  it('gestor lê ligação de qualquer usuário da org', async () => {
    const f = fakeSupabase({ calls: baseCall({ user_id: 'outro' }) });
    const r = await fetchCockpitCallOutcome(f.client, { ...sdr, isManager: true }, CALL_ID);
    expect(r.status).toBe('ok');
  });

  it('ligação inexistente ou de outra org: não encontrada', async () => {
    const f = fakeSupabase({ calls: null });
    expect(await fetchCockpitCallOutcome(f.client, sdr, CALL_ID)).toEqual({ status: 'not_found' });
  });
});
