import { afterEach, describe, expect, it, vi } from 'vitest';

const cookieValue = vi.hoisted(() => ({ current: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: () => (cookieValue.current ? { value: cookieValue.current } : undefined),
  })),
}));

import { effectiveRole } from './dev-view-as';

describe('effectiveRole (Ver como SDR — só dev)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    cookieValue.current = undefined;
  });

  it('em dev, gestor com cookie sdr vira SDR', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    cookieValue.current = 'sdr';
    expect(await effectiveRole('manager')).toBe('sdr');
  });

  it('em dev, sem cookie mantém gestor', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(await effectiveRole('manager')).toBe('manager');
  });

  it('nunca promove SDR', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    cookieValue.current = 'manager';
    expect(await effectiveRole('sdr')).toBe('sdr');
  });

  it('em produção ignora o cookie', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    cookieValue.current = 'sdr';
    expect(await effectiveRole('manager')).toBe('manager');
  });
});
