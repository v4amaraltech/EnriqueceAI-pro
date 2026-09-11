import { describe, expect, it } from 'vitest';

import { isLocalSupabaseUrl, shouldRunIntegration } from './supabase-test-client';

// AC4 da story statistics-rpc-integration-tests: nunca rodar contra prod.
describe('trava dos testes de integração', () => {
  const REAL_KEY = 'eyJhbGciOiJIUzI1NiJ9.qualquer.coisa';

  it('roda só com Supabase local e chave real', () => {
    expect(
      shouldRunIntegration({
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: REAL_KEY,
      }),
    ).toBe(true);
    expect(
      shouldRunIntegration({
        SUPABASE_URL: 'http://localhost:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x',
      }),
    ).toBe(true);
  });

  it('NÃO roda apontando para prod, mesmo com chave válida', () => {
    expect(
      shouldRunIntegration({
        SUPABASE_URL: 'https://dhkmonctyoaenejemkrt.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: REAL_KEY,
      }),
    ).toBe(false);
    // host que só "contém" localhost não passa
    expect(
      shouldRunIntegration({
        SUPABASE_URL: 'https://localhost.evil.com',
        SUPABASE_SERVICE_ROLE_KEY: REAL_KEY,
      }),
    ).toBe(false);
  });

  it('NÃO roda sem URL, sem chave ou com a chave falsa dos testes unitários', () => {
    expect(shouldRunIntegration({ SUPABASE_SERVICE_ROLE_KEY: REAL_KEY })).toBe(false);
    expect(shouldRunIntegration({ SUPABASE_URL: 'http://127.0.0.1:54321' })).toBe(false);
    expect(
      shouldRunIntegration({
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      }),
    ).toBe(false);
  });

  it('URL inválida não é local', () => {
    expect(isLocalSupabaseUrl('não é url')).toBe(false);
    expect(isLocalSupabaseUrl(undefined)).toBe(false);
  });
});
