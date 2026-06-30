import { afterEach, describe, expect, it, vi } from 'vitest';

import { crmFetch } from './crm-http';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('crmFetch', () => {
  it('returns parsed JSON on ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ id: 'x' }) }),
    );
    const out = await crmFetch<{ id: string }>('https://api.test/x', { label: 'Test' });
    expect(out.id).toBe('x');
  });

  it('returns an empty object on 204 (no body parse)', async () => {
    const json = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json }));
    const out = await crmFetch('https://api.test/x', { label: 'Test' });
    expect(out).toEqual({});
    expect(json).not.toHaveBeenCalled();
  });

  it('throws a labeled error on non-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 422, text: () => Promise.resolve('bad input') }),
    );
    await expect(crmFetch('https://api.test/x', { label: 'Kommo' })).rejects.toThrow(
      'Kommo API error (422): bad input',
    );
  });
});
