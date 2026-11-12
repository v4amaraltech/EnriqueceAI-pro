import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WEBPHONE_INSTANCE_ID_KEY,
  getWebphoneInstanceId,
  isValidInstanceId,
  newInstanceUUID,
  resetWebphoneInstanceIdForTests,
} from './webphone-instance-id';

const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '6f1c2a3e-0000-4000-8000-000000000031';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    data,
  };
}

beforeEach(() => resetWebphoneInstanceIdForTests());

describe('getWebphoneInstanceId', () => {
  it('primeira chamada gera e grava; a segunda devolve o mesmo', () => {
    const storage = memoryStorage();
    const randomUUID = vi.fn().mockReturnValueOnce(UUID_A).mockReturnValueOnce(UUID_B);
    expect(getWebphoneInstanceId({ storage, randomUUID })).toBe(UUID_A);
    expect(storage.data.get(WEBPHONE_INSTANCE_ID_KEY)).toBe(UUID_A);
    expect(getWebphoneInstanceId({ storage, randomUUID })).toBe(UUID_A);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('valor inválido no storage é descartado e regerado', () => {
    for (const bad of ['', 'abc', `urn:uuid:${UUID_A}`, `${UUID_A}x`]) {
      const storage = memoryStorage({ [WEBPHONE_INSTANCE_ID_KEY]: bad });
      expect(getWebphoneInstanceId({ storage, randomUUID: () => UUID_B })).toBe(UUID_B);
      expect(storage.data.get(WEBPHONE_INSTANCE_ID_KEY)).toBe(UUID_B);
    }
  });

  it('falha de storage não lança, devolve UUID válido e estável nesta aba', () => {
    const storage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    const randomUUID = vi.fn().mockReturnValueOnce(UUID_A).mockReturnValueOnce(UUID_B);
    const first = getWebphoneInstanceId({ storage, randomUUID });
    expect(first).toBe(UUID_A);
    expect(getWebphoneInstanceId({ storage, randomUUID })).toBe(UUID_A);
  });

  it('sem storage usa UUID em memória', () => {
    const first = getWebphoneInstanceId({ storage: null, randomUUID: () => UUID_A });
    expect(first).toBe(UUID_A);
    expect(getWebphoneInstanceId({ storage: null, randomUUID: () => UUID_B })).toBe(UUID_A);
  });

  it('gerador que devolve lixo cai no UUID v4 próprio', () => {
    const id = getWebphoneInstanceId({ storage: memoryStorage(), randomUUID: () => 'nope' });
    expect(isValidInstanceId(id)).toBe(true);
  });

  it('newInstanceUUID gera UUID aceito pelo JsSIP', () => {
    expect(isValidInstanceId(newInstanceUUID())).toBe(true);
    expect(isValidInstanceId(`uuid:${UUID_A}`)).toBe(false);
  });
});
