import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPublicHttps, isApi4ComHost, isPrivateHost, isSafeApi4ComBaseUrl, parsePublicHttpsUrl } from './safe-url';

describe('isPrivateHost', () => {
  it.each(['localhost', '127.0.0.1', '10.0.0.5', '172.16.1.1', '192.168.0.1', '169.254.169.254', '[::1]', '0.0.0.0', 'metadata.google.internal', 'db.internal', '2130706433'])(
    'bloqueia %s',
    (h) => expect(isPrivateHost(h)).toBe(true),
  );
  it.each(['api.api4com.com', 'example.com', '8.8.8.8'])('permite %s', (h) => expect(isPrivateHost(h)).toBe(false));
});

describe('parsePublicHttpsUrl / api4com', () => {
  it('rejeita http, credenciais e host privado', () => {
    expect(parsePublicHttpsUrl('http://example.com/x')).toBeNull();
    expect(parsePublicHttpsUrl('https://u:p@example.com/x')).toBeNull();
    expect(parsePublicHttpsUrl('https://127.0.0.1/x')).toBeNull();
    expect(parsePublicHttpsUrl('http://example.com/x', { allowHttp: true })).not.toBeNull();
  });
  it('allowlist da API4COM', () => {
    expect(isApi4ComHost('api.api4com.com')).toBe(true);
    expect(isApi4ComHost('evilapi4com.com')).toBe(false);
    expect(isSafeApi4ComBaseUrl('https://api.api4com.com/api/v1')).toBe(true);
    expect(isSafeApi4ComBaseUrl('http://api.api4com.com/api/v1')).toBe(false);
    expect(isSafeApi4ComBaseUrl('https://api4com.com.attacker.example/')).toBe(false);
    expect(isSafeApi4ComBaseUrl('http://127.0.0.1:8080/redir/')).toBe(false);
  });
});

describe('fetchPublicHttps', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('não faz fetch para host privado', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await fetchPublicHttps('http://169.254.169.254/latest')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('bloqueia redirect para host privado', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }));
    vi.stubGlobal('fetch', f);
    expect(await fetchPublicHttps('https://example.com/a.mp3')).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('segue redirect público e devolve a resposta', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://cdn.example.com/a.mp3' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const res = await fetchPublicHttps('https://example.com/a.mp3');
    expect(res?.status).toBe(200);
  });
});
