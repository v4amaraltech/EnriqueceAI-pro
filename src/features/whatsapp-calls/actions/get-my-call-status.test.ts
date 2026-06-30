import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'u1', email: 'sdr@test.com' }),
}));

let sessionData: unknown = null;

function makeChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: sessionData }));
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve({ from: () => makeChain() })),
}));

import { getMyWhatsAppCallStatus } from './get-my-call-status';

describe('getMyWhatsAppCallStatus', () => {
  it('returns paired=true with the phone when a connected session exists', async () => {
    sessionData = { phone_number: '5511999990000', status: 'connected' };
    const r = await getMyWhatsAppCallStatus();
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.paired).toBe(true);
      expect(r.data.phoneNumber).toBe('5511999990000');
    }
  });

  it('returns paired=false when there is no connected session', async () => {
    sessionData = null;
    const r = await getMyWhatsAppCallStatus();
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.paired).toBe(false);
      expect(r.data.phoneNumber).toBeNull();
    }
  });
});
