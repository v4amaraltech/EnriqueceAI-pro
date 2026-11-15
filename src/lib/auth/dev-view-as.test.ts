import { afterEach, describe, expect, it, vi } from 'vitest';

const { cookieValue, cookieStore, cookiesMock } = vi.hoisted(() => {
  const cookieValue = { current: undefined as string | undefined };
  const cookieStore = {
    get: () => (cookieValue.current ? { value: cookieValue.current } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  };
  return { cookieValue, cookieStore, cookiesMock: vi.fn(async () => cookieStore) };
});

vi.mock('next/headers', () => ({ cookies: cookiesMock }));

import { setDevViewAs } from './dev-view-as-actions';
import { effectiveRole } from './dev-view-as';

describe('effectiveRole (Ver como SDR — só dev)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    cookieValue.current = undefined;
    vi.clearAllMocks();
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

  it('em produção nem lê o cookie (cookies() não é chamado)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    cookieValue.current = 'sdr';
    await effectiveRole('manager');
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("com NODE_ENV='test' também ignora o cookie", async () => {
    vi.stubEnv('NODE_ENV', 'test');
    cookieValue.current = 'sdr';
    expect(await effectiveRole('manager')).toBe('manager');
    expect(cookiesMock).not.toHaveBeenCalled();
  });
});

describe('setDevViewAs (Server Action)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('recusa fora do desenvolvimento e não mexe no cookie', async () => {
    for (const env of ['production', 'test']) {
      vi.stubEnv('NODE_ENV', env);
      const result = await setDevViewAs('sdr');
      expect(result).toEqual({
        success: false,
        error: 'Disponível só no ambiente de desenvolvimento',
      });
    }
    expect(cookiesMock).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });
});
