import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
const service = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));
const api4com = vi.hoisted(() => ({
  API4COM_DEFAULT_BASE_URL: 'https://api.api4com.com/api/v1/',
  ensureCallWebhookWithCredentials: vi.fn(),
  getOrgSettingsCredentials: vi.fn(),
  listExtensions: vi.fn(),
  normalizeBaseUrl: (u?: string | null) => (u?.trim() || 'https://api.api4com.com/api/v1/').replace(/\/+$/, ''),
}));

vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('@/lib/security/encryption', () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  isEncryptionConfigured: vi.fn(() => true),
}));
vi.mock('@/lib/supabase/service', () => service);
vi.mock('@/lib/auth/user-directory', () => ({ resolveUserProfiles: vi.fn().mockResolvedValue(new Map()) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../services/api4com.service', () => api4com);

import { assignApi4ComExtension } from './manage-api4com-org';

/** Builder encadeável: SELECT devolve as linhas da tabela; UPDATE/INSERT ficam registrados. */
function mockClient(tables: Record<string, unknown[]>) {
  const writes: Array<{ table: string; op: 'update' | 'insert'; values: Record<string, unknown> }> = [];
  const client = {
    from: vi.fn((table: string) => {
      const result = { data: tables[table] ?? [], error: null };
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = vi.fn(self);
      chain.eq = vi.fn(self);
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      chain.update = vi.fn((values: Record<string, unknown>) => {
        writes.push({ table, op: 'update', values });
        return chain;
      });
      chain.insert = vi.fn((values: Record<string, unknown>) => {
        writes.push({ table, op: 'insert', values });
        return Promise.resolve({ error: null });
      });
      return chain;
    }),
  };
  return { client, writes };
}

const members = [
  { user_id: 'ismael', role: 'sdr' },
  { user_id: 'guilherme', role: 'sdr' },
];
const extensions = [
  { id: 24, ramal: '1024', senha: 'sip-1024', domain: 'v4amaral.api4com.com', email_address: 'ismael@x.com' },
  { id: 49, ramal: '1049', senha: 'sip-1049', domain: 'v4amaral.api4com.com', email_address: 'ismael@x.com' },
];

describe('assignApi4ComExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getAuthOrgIdResult.mockResolvedValue({
      success: true,
      data: { orgId: 'org', userId: 'gestor', role: 'manager', supabase: {} },
    });
    api4com.getOrgSettingsCredentials.mockResolvedValue({ apiKey: 'tok', baseUrl: 'https://api.api4com.com/api/v1' });
    api4com.listExtensions.mockResolvedValue(extensions);
  });

  it('cria a linha de quem está sem ramal, com senha SIP do ramal escolhido', async () => {
    const { client, writes } = mockClient({
      organization_members: members,
      api4com_connections: [{ user_id: 'guilherme', ramal: '1033' }],
    });
    service.createServiceRoleClient.mockReturnValue(client);

    const r = await assignApi4ComExtension({ userId: 'ismael', ramal: '1024' });

    expect(r).toEqual({ success: true, data: { ramal: '1024' } });
    const insert = writes.find((w) => w.op === 'insert');
    expect(insert?.values).toMatchObject({
      user_id: 'ismael',
      ramal: '1024',
      sip_password_encrypted: 'enc:sip-1024',
      sip_domain: 'v4amaral.api4com.com',
      api_key_encrypted: null,
      status: 'connected',
    });
  });

  it('troca o ramal de quem já tem linha (update, sem mexer no webphone)', async () => {
    const { client, writes } = mockClient({
      organization_members: members,
      api4com_connections: [{ user_id: 'ismael', ramal: '1049', webphone_enabled: true }],
    });
    service.createServiceRoleClient.mockReturnValue(client);

    const r = await assignApi4ComExtension({ userId: 'ismael', ramal: '1024' });

    expect(r.success).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.op).toBe('update');
    expect(writes[0]?.values).not.toHaveProperty('webphone_enabled');
  });

  it('recusa ramal que já está com outra pessoa', async () => {
    const { client, writes } = mockClient({
      organization_members: members,
      api4com_connections: [{ user_id: 'guilherme', ramal: '1024' }],
    });
    service.createServiceRoleClient.mockReturnValue(client);

    const r = await assignApi4ComExtension({ userId: 'ismael', ramal: '1024' });

    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/outra pessoa/);
    expect(writes).toHaveLength(0);
  });

  it('recusa ramal que não existe na conta', async () => {
    const { client, writes } = mockClient({ organization_members: members, api4com_connections: [] });
    service.createServiceRoleClient.mockReturnValue(client);

    const r = await assignApi4ComExtension({ userId: 'ismael', ramal: '9999' });

    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/não existe/);
    expect(writes).toHaveLength(0);
  });

  it('só gestor define ramal', async () => {
    auth.getAuthOrgIdResult.mockResolvedValue({
      success: true,
      data: { orgId: 'org', userId: 'ismael', role: 'sdr', supabase: {} },
    });

    const r = await assignApi4ComExtension({ userId: 'ismael', ramal: '1024' });

    expect(r.success).toBe(false);
    expect(service.createServiceRoleClient).not.toHaveBeenCalled();
  });
});
