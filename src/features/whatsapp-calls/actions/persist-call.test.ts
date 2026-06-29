import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'u1', email: 'sdr@test.com' }),
}));

let queues: Record<string, unknown[]>;

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'insert']) chain[m] = vi.fn(() => chain);
  const shift = () => (queues[table]?.shift() ?? { data: null, error: null });
  chain.single = vi.fn(() => Promise.resolve(shift()));
  chain.maybeSingle = vi.fn(() => Promise.resolve(shift()));
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() =>
    Promise.resolve({ from: (table: string) => makeChain(table) }),
  ),
}));

import { persistWhatsAppCall, type PersistWhatsAppCallInput } from './persist-call';

const baseInput: PersistWhatsAppCallInput = {
  stepId: '11111111-1111-1111-1111-111111111111',
  cadenceId: '22222222-2222-2222-2222-222222222222',
  leadId: '33333333-3333-3333-3333-333333333333',
  sid: 'sess-1',
  callId: 'call-svc-1',
  destination: '5511999990000',
  disposition: 'significant',
  connected: true,
  durationSeconds: 42,
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  answeredAt: new Date(Date.now() - 50_000).toISOString(),
};

describe('persistWhatsAppCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queues = {};
  });

  it('inserts the call + interaction and returns the call id', async () => {
    queues.organization_members = [{ data: { org_id: 'org-1' } }];
    queues.calls = [
      { data: null }, // dedup: no existing call
      { data: { id: 'call-1' }, error: null }, // insert ... select single
    ];

    const result = await persistWhatsAppCall(baseInput);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.callId).toBe('call-1');
  });

  it('is idempotent on the same service_call_id', async () => {
    queues.organization_members = [{ data: { org_id: 'org-1' } }];
    queues.calls = [{ data: { id: 'existing-1' } }]; // dedup hit

    const result = await persistWhatsAppCall(baseInput);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.callId).toBe('existing-1');
  });

  it('errors when the user has no organization', async () => {
    queues.organization_members = [{ data: null }];
    const result = await persistWhatsAppCall(baseInput);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('Organização não encontrada');
  });

  it('rejects invalid input', async () => {
    const result = await persistWhatsAppCall({ ...baseInput, leadId: 'nope' });
    expect(result.success).toBe(false);
  });
});
