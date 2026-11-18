import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWebphoneCallOutcome } from './fetch-webphone-call-outcome';

describe('fetchWebphoneCallOutcome', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('consulta a rota GET (fora da fila de Server Actions)', async () => {
    const body = { success: true, data: { leadAnswer: 'not_answered' } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchWebphoneCallOutcome('id 1')).toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith('/api/webphone/call-outcome?callId=id%201', { cache: 'no-store' });
  });

  it('devolve null em erro HTTP ou de rede', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', { status: 500 })));
    expect(await fetchWebphoneCallOutcome('a')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchWebphoneCallOutcome('a')).toBeNull();
  });
});
