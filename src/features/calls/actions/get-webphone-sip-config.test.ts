import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
const service = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('@/lib/supabase/service', () => service);
vi.mock('@/lib/security/encryption', () => ({ decrypt: (v: string) => v.replace(/^enc:/, '') }));

import { getWebphoneSipConfig } from './get-webphone-sip-config';

function clientWith(row: Record<string, unknown> | null) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) chain[m] = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: row, error: null });
  return { from: () => chain };
}

const base = { ramal: '1014', sip_domain: 'V4amaral.api4com.com', sip_password_encrypted: 'enc:segredo', webphone_enabled: true, status: 'connected' };

describe('getWebphoneSipConfig', () => {
  beforeEach(() => {
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org', userId: 'u1', role: 'sdr', supabase: {} } });
  });

  it('devolve domínio, ramal e senha quando o webphone está liberado', async () => {
    service.createServiceRoleClient.mockReturnValue(clientWith(base));
    const r = await getWebphoneSipConfig();
    expect(r).toEqual({ success: true, data: { enabled: true, sipDomain: 'v4amaral.api4com.com', ramal: '1014', sipPassword: 'segredo' } });
  });

  it('desligado para quem o gestor não liberou', async () => {
    service.createServiceRoleClient.mockReturnValue(clientWith({ ...base, webphone_enabled: false }));
    const r = await getWebphoneSipConfig();
    expect(r).toEqual({ success: true, data: { enabled: false, reason: 'not_enabled' } });
  });

  it('desligado sem linha, sem senha SIP ou com conexão em erro', async () => {
    service.createServiceRoleClient.mockReturnValue(clientWith(null));
    expect(await getWebphoneSipConfig()).toEqual({ success: true, data: { enabled: false, reason: 'no_connection' } });

    service.createServiceRoleClient.mockReturnValue(clientWith({ ...base, sip_password_encrypted: null }));
    expect(await getWebphoneSipConfig()).toEqual({ success: true, data: { enabled: false, reason: 'missing_sip' } });

    service.createServiceRoleClient.mockReturnValue(clientWith({ ...base, status: 'error' }));
    expect(await getWebphoneSipConfig()).toEqual({ success: true, data: { enabled: false, reason: 'no_connection' } });
  });
});
