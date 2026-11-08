import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/env', () => ({
  getEnv: () => ({ WACALLS_BASE_URL: 'https://voice.invalid/', WACALLS_API_KEY: 'k' }),
}));

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => Promise.resolve(result));
  return c;
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
      from: () => chain({ data: [{ service_session_id: 'sid-a' }] }),
    }),
  ),
}));

import { GET } from './route';

describe('GET /api/whatsapp-calls/events', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('ignora o clientId da query e filtra eventos por sessão do usuário', async () => {
    const body = [
      'data: {"sessionId":"sid-b","qr":"wa.me/outro"}\n\ndata: {"sessionId":"sid-a","paired":true}\n\n',
    ].join('');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    const res = await GET(new NextRequest('https://app.invalid/api/whatsapp-calls/events?clientId=enriquece-vitima'));
    const text = await res.text();

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('clientId=enriquece-user-1');
    expect(url).not.toContain('vitima');
    expect(text).toContain('sid-a');
    expect(text).not.toContain('sid-b');
  });
});
