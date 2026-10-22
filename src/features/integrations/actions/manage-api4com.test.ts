import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
const api4com = vi.hoisted(() => ({ hasOrgApi4ComToken: vi.fn() }));

vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('@/lib/security/encryption', () => ({ encrypt: vi.fn((v: string) => `enc:${v}`) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../services/api4com.service', () => api4com);

import { disconnectApi4Com } from './manage-api4com';

function mockSupabase() {
  const eqUser = vi.fn().mockResolvedValue({ error: null });
  const eqOrg = vi.fn(() => ({ eq: eqUser }));
  const del = vi.fn(() => ({ eq: eqOrg }));
  return { client: { from: vi.fn(() => ({ delete: del })) }, del };
}

function asRole(role: 'manager' | 'sdr', supabase: unknown) {
  auth.getAuthOrgIdResult.mockResolvedValue({
    success: true,
    data: { orgId: 'org', userId: 'u1', role, supabase },
  });
}

describe('disconnectApi4Com', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SDR não desconecta quando a org tem token da conta', async () => {
    const { client, del } = mockSupabase();
    asRole('sdr', client);
    api4com.hasOrgApi4ComToken.mockResolvedValue(true);

    const r = await disconnectApi4Com();

    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/gestor/);
    expect(del).not.toHaveBeenCalled();
  });

  it('SDR desconecta quando a org não tem token (token próprio legado)', async () => {
    const { client, del } = mockSupabase();
    asRole('sdr', client);
    api4com.hasOrgApi4ComToken.mockResolvedValue(false);

    const r = await disconnectApi4Com();

    expect(r.success).toBe(true);
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('gestor desconecta mesmo com token da org', async () => {
    const { client, del } = mockSupabase();
    asRole('manager', client);
    api4com.hasOrgApi4ComToken.mockResolvedValue(true);

    const r = await disconnectApi4Com();

    expect(r.success).toBe(true);
    expect(del).toHaveBeenCalledTimes(1);
    expect(api4com.hasOrgApi4ComToken).not.toHaveBeenCalled();
  });
});
