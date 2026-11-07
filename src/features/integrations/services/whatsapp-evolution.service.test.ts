import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/env', () => ({
  getEnv: () => ({ EVOLUTION_API_URL: 'https://evo.test/', EVOLUTION_API_KEY: 'k' }),
}));

import { EvolutionWhatsAppService } from './whatsapp-evolution.service';

function fakeSupabase(instance: Record<string, unknown> | null) {
  const filters: Array<[string, unknown]> = [];
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.eq = vi.fn((c: string, v: unknown) => {
    filters.push([c, v]);
    return builder;
  });
  builder.is = vi.fn((c: string, v: unknown) => {
    filters.push([c, v]);
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: instance }));
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
  return { client: { from: vi.fn(() => builder) } as never, filters };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('EvolutionWhatsAppService.sendFromUserInstance', () => {
  const params = { orgId: 'org-1', userId: 'sdr-1', to: '11999998888', body: 'Oi', delayMs: 4000 };

  it('busca só a instância do próprio SDR — nunca a da organização (critério 5)', async () => {
    const fake = fakeSupabase(null);
    const r = await EvolutionWhatsAppService.sendFromUserInstance(fake.client, params);
    expect(r).toMatchObject({ success: false, code: 'no_instance' });
    expect(fake.filters).toContainEqual(['user_id', 'sdr-1']);
    expect(fake.filters.some(([c, v]) => c === 'user_id' && v === null)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('instância desconectada não envia', async () => {
    const fake = fakeSupabase({ id: 'i', instance_name: 'ea_1', status: 'disconnected', phone: null, user_id: 'sdr-1' });
    const r = await EvolutionWhatsAppService.sendFromUserInstance(fake.client, params);
    expect(r).toMatchObject({ success: false, code: 'disconnected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envia com "digitando…" (delay) pela instância do SDR (critério 16)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ key: { id: 'wamid-1' } }) });
    const fake = fakeSupabase({ id: 'i', instance_name: 'ea_1', status: 'connected', phone: null, user_id: 'sdr-1' });
    const r = await EvolutionWhatsAppService.sendFromUserInstance(fake.client, params);
    expect(r).toEqual({ success: true, messageId: 'wamid-1' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://evo.test/message/sendText/ea_1');
    expect(JSON.parse((init as { body: string }).body)).toMatchObject({ text: 'Oi', delay: 4000 });
  });

  it('sessão caída vira code=disconnected', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ response: { message: 'Connection Closed' } })),
    });
    const fake = fakeSupabase({ id: 'i', instance_name: 'ea_1', status: 'connected', phone: null, user_id: 'sdr-1' });
    const r = await EvolutionWhatsAppService.sendFromUserInstance(fake.client, params);
    expect(r).toMatchObject({ success: false, code: 'disconnected' });
  });
});
