import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/lib/auth/get-org-id', () => auth);

import { classifyWebphoneCall } from './classify-webphone-call';

const CALL_ID = '6f1c2a3e-0000-4000-8000-000000000003';

/** Supabase falso: `calls` devolve `callRow`; registra os updates de `calls`. */
function supabaseWith(callRow: Record<string, unknown>) {
  const callUpdates: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'contains', 'limit']) chain[m] = () => chain;
      chain.single = () => Promise.resolve({ data: table === 'calls' ? callRow : null, error: null });
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.insert = () => Promise.resolve({ error: null });
      chain.update = (payload: Record<string, unknown>) => {
        if (table === 'calls') callUpdates.push(payload);
        const upd: Record<string, unknown> = { eq: () => upd, then: (r: (v: unknown) => void) => r({ error: null }) };
        return upd;
      };
      return chain;
    },
  };
  return { client, callUpdates };
}

describe('classifyWebphoneCall — duração', () => {
  beforeEach(() => auth.getAuthOrgIdResult.mockReset());

  it('webhook já fechou a ligação (hangup_cause) com 0 s → NÃO grava o tempo da tela', async () => {
    const { client, callUpdates } = supabaseWith({ id: CALL_ID, duration_seconds: 0, lead_id: null, org_id: 'org', hangup_cause: 'NUMBER_CHANGED' });
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org', userId: 'u1', supabase: client } });

    await classifyWebphoneCall({ callId: CALL_ID, clientDurationSeconds: 9, notes: 'caixa postal' });

    expect(callUpdates).toHaveLength(1);
    expect(callUpdates[0]).not.toHaveProperty('duration_seconds');
    expect(callUpdates[0]).toMatchObject({ notes: 'caixa postal' });
  });

  it('webhook ainda não chegou → usa o tempo da tela como reserva', async () => {
    const { client, callUpdates } = supabaseWith({ id: CALL_ID, duration_seconds: 0, lead_id: null, org_id: 'org', hangup_cause: null });
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org', userId: 'u1', supabase: client } });

    await classifyWebphoneCall({ callId: CALL_ID, clientDurationSeconds: 42 });

    expect(callUpdates[0]).toMatchObject({ duration_seconds: 42 });
  });
});
