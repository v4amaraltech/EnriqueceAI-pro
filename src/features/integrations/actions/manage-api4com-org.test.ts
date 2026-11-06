import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
const encryption = vi.hoisted(() => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  isEncryptionConfigured: vi.fn(() => true),
}));
const service = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));
const api4com = vi.hoisted(() => ({
  API4COM_DEFAULT_BASE_URL: 'https://api.api4com.com/api/v1/',
  ensureCallWebhookWithCredentials: vi.fn(),
  getOrgSettingsCredentials: vi.fn(),
  listExtensions: vi.fn(),
  normalizeBaseUrl: (u?: string | null) => (u?.trim() || 'https://api.api4com.com/api/v1/').replace(/\/+$/, ''),
}));

vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('@/lib/security/encryption', () => encryption);
vi.mock('@/lib/supabase/service', () => service);
vi.mock('@/lib/auth/user-directory', () => ({ resolveUserProfiles: vi.fn().mockResolvedValue(new Map()) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../services/api4com.service', () => api4com);

import { saveApi4ComOrgSettings, syncApi4ComExtensions } from './manage-api4com-org';

describe('manage-api4com-org: trava de criptografia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getAuthOrgIdResult.mockResolvedValue({
      success: true,
      data: { orgId: 'org', userId: 'u1', role: 'manager', supabase: {} },
    });
  });

  it('recusa salvar o token quando TOKEN_ENCRYPTION_KEY não está configurada', async () => {
    encryption.isEncryptionConfigured.mockReturnValue(false);
    const r = await saveApi4ComOrgSettings({ apiToken: 'tok' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/TOKEN_ENCRYPTION_KEY/);
    expect(api4com.listExtensions).not.toHaveBeenCalled();
    expect(service.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it('recusa sincronizar ramais quando TOKEN_ENCRYPTION_KEY não está configurada', async () => {
    encryption.isEncryptionConfigured.mockReturnValue(false);
    const r = await syncApi4ComExtensions();
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/TOKEN_ENCRYPTION_KEY/);
    expect(api4com.getOrgSettingsCredentials).not.toHaveBeenCalled();
  });

  it('só gestor configura a org', async () => {
    auth.getAuthOrgIdResult.mockResolvedValue({
      success: true,
      data: { orgId: 'org', userId: 'u1', role: 'sdr', supabase: {} },
    });
    const r = await saveApi4ComOrgSettings({ apiToken: 'tok' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/gestores/);
  });
});
