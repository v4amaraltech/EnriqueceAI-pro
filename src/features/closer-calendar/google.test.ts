import { afterEach, describe, expect, it } from 'vitest';

import { refreshCloserAccessToken } from './google';

describe('renovação do token do closer', () => {
  afterEach(() => {
    delete process.env.GCAL_CLIENT_ID;
    delete process.env.GCAL_CLIENT_SECRET;
  });

  it('token revogado no Google vira desconexão, falha transitória não', async () => {
    process.env.GCAL_CLIENT_ID = 'client';
    process.env.GCAL_CLIENT_SECRET = 'secret';
    const revoked = await refreshCloserAccessToken('refresh-1', async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    expect(revoked).toEqual({ ok: false, revoked: true });

    const down = await refreshCloserAccessToken('refresh-1', async () => new Response('unavailable', { status: 503 }));
    expect(down).toEqual({ ok: false, revoked: false });
  });

  it('renovação bem sucedida devolve o access token novo', async () => {
    process.env.GCAL_CLIENT_ID = 'client';
    process.env.GCAL_CLIENT_SECRET = 'secret';
    let body = '';
    const result = await refreshCloserAccessToken('refresh-1', async (_url, init) => {
      body = String(init?.body ?? '');
      return new Response(JSON.stringify({ access_token: 'novo', expires_in: 1800 }), { status: 200 });
    });
    expect(result).toEqual({ ok: true, accessToken: 'novo', expiresIn: 1800 });
    expect(body).toContain('grant_type=refresh_token');
    expect(body).not.toMatch(/gmail/i);
  });
});
