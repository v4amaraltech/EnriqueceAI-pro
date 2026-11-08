import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveApiKey = vi.fn();
vi.mock('./api-key.service', () => ({
  hashApiKey: (k: string) => `hash:${k}`,
  resolveApiKey: (...a: unknown[]) => resolveApiKey(...a),
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({}) }));

import { authenticateApiKey, hasScope } from './api-key-auth';

const row = (scopes: string[]) => ({ id: 'k1', org_id: 'org-1', scopes });
const bearer = (key = 'abc') => new Request('https://x.test/api', { headers: { authorization: `Bearer ${key}` } });

describe('hasScope (pista 23)', () => {
  it('aceita escopo exato e curinga, rejeita o resto', () => {
    expect(hasScope(['leads.write'], 'leads.write')).toBe(true);
    expect(hasScope(['*'], 'bdr.email')).toBe(true);
    expect(hasScope(['leads.write'], 'bdr.email')).toBe(false);
    expect(hasScope([], 'leads.write')).toBe(false);
    expect(hasScope(null, 'leads.write')).toBe(false);
  });
});

describe('authenticateApiKey', () => {
  beforeEach(() => resolveApiKey.mockReset());

  it('devolve os escopos da chave', async () => {
    resolveApiKey.mockResolvedValue(row(['leads.write']));
    expect(await authenticateApiKey(bearer())).toEqual({ orgId: 'org-1', keyId: 'k1', scopes: ['leads.write'] });
  });

  it('sem requiredScope não muda o comportamento atual', async () => {
    resolveApiKey.mockResolvedValue(row(['leads.write']));
    expect(await authenticateApiKey(bearer())).not.toBeNull();
  });

  it('nega quando a chave não tem o escopo exigido', async () => {
    resolveApiKey.mockResolvedValue(row(['leads.write']));
    expect(await authenticateApiKey(bearer(), { requiredScope: 'bdr.email' })).toBeNull();
    expect(await authenticateApiKey(bearer(), { requiredScope: 'leads.write' })).not.toBeNull();
  });

  it('?token= é aceito por padrão e recusado com allowQueryToken=false', async () => {
    resolveApiKey.mockResolvedValue(row(['leads.write']));
    const req = new Request('https://x.test/api?token=abc');
    expect(await authenticateApiKey(req)).not.toBeNull();
    expect(await authenticateApiKey(req, { allowQueryToken: false })).toBeNull();
  });
});
