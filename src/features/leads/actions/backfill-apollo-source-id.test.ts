import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkRateLimit = vi.fn();
vi.mock('@/lib/security/rate-limit', () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock('@/lib/auth/require-auth-with-member', () => ({
  requireAuthWithMember: vi.fn().mockResolvedValue({ orgId: 'org-1', userId: 'u1', role: 'sdr' }),
}));
const createClient = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: () => createClient() }));
const getKey = vi.fn();
vi.mock('../services/apollo-key.service', () => ({
  getApolloApiKey: (...a: unknown[]) => getKey(...a),
  buildApolloWebhookUrl: vi.fn(),
}));
vi.mock('../services/apollo.service', () => ({ enrichPerson: vi.fn(), apolloPhoneTipo: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { backfillApolloSourceIds } from './backfill-apollo-source-id';

describe('backfillApolloSourceIds (pista 29)', () => {
  beforeEach(() => {
    checkRateLimit.mockReset();
    getKey.mockReset();
    createClient.mockReset();
  });

  it('bloqueia quando o rate limit estoura, sem chamar o Apollo', async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, limit: 2 });
    const r = await backfillApolloSourceIds();
    expect(r.success).toBe(false);
    expect(checkRateLimit).toHaveBeenCalledWith('apollo-backfill:org-1', 2, 600_000);
    expect(getKey).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('segue o fluxo quando dentro do limite', async () => {
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 1, limit: 2 });
    createClient.mockResolvedValue({});
    getKey.mockResolvedValue(null);
    const r = await backfillApolloSourceIds();
    expect(getKey).toHaveBeenCalledWith('org-1');
    expect(r.success).toBe(false);
  });
});
