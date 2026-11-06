import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { applySdrCallResult } from './apply-sdr-call-result';

const CALL_ID = '6f1c2a3e-0000-4000-8000-000000000020';

function fake(interaction: Record<string, unknown> | null) {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'contains', 'limit']) chain[m] = () => chain;
      chain.single = () =>
        Promise.resolve({ data: { id: CALL_ID, duration_seconds: 0, lead_id: 'lead-1', org_id: 'org', hangup_cause: null }, error: null });
      chain.maybeSingle = () => Promise.resolve({ data: interaction, error: null });
      chain.insert = (payload: Record<string, unknown>) => {
        inserts.push({ table, payload });
        return Promise.resolve({ error: null });
      };
      chain.update = () => {
        const upd: Record<string, unknown> = { eq: () => upd, then: (r: (v: unknown) => void) => r({ error: null }) };
        return upd;
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, inserts };
}

describe('applySdrCallResult', () => {
  it('sem interação da ligação → insere UMA, com os campos da etapa e a origem', async () => {
    const { client, inserts } = fake(null);
    const r = await applySdrCallResult(client, {
      orgId: 'org',
      userId: 'u1',
      callId: CALL_ID,
      clientDurationSeconds: 0,
      notes: 'retornar',
      interactionFields: { cadence_id: 'c1', step_id: 's1' },
      via: 'power_dialer',
    });

    expect(r).toEqual({ success: true, data: { callId: CALL_ID, leadId: 'lead-1' } });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      table: 'interactions',
      payload: { lead_id: 'lead-1', cadence_id: 'c1', step_id: 's1', message_content: 'retornar', metadata: { callId: CALL_ID, source: 'power_dialer' } },
    });
  });

  it('com interação existente → não insere nada', async () => {
    const { client, inserts } = fake({ id: 'int-1', metadata: { callId: CALL_ID }, message_content: 'x' });
    await applySdrCallResult(client, { orgId: 'org', userId: 'u1', callId: CALL_ID, clientDurationSeconds: 0, via: 'webphone' });
    expect(inserts).toEqual([]);
  });
});
