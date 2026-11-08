import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/lib/security/encryption', () => ({ decrypt: vi.fn(), encrypt: vi.fn() }));

import { API4COM_DEFAULT_BASE_URL, normalizeBaseUrl } from './api4com.service';

describe('normalizeBaseUrl (pista 8)', () => {
  const def = API4COM_DEFAULT_BASE_URL.replace(/\/+$/, '');
  it('mantém host da API4COM', () => {
    expect(normalizeBaseUrl('https://api.api4com.com/api/v1/')).toBe('https://api.api4com.com/api/v1');
  });
  it('usa o padrão para host fora da allowlist, http ou IP interno', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(normalizeBaseUrl('http://127.0.0.1:9000/redir/')).toBe(def);
    expect(normalizeBaseUrl('https://attacker.example/api')).toBe(def);
    expect(normalizeBaseUrl('http://api.api4com.com/api/v1')).toBe(def);
  });
  it('vazio vira o padrão', () => {
    expect(normalizeBaseUrl(null)).toBe(def);
  });
});
