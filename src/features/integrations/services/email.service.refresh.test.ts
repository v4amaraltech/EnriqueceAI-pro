import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/security/encryption', () => ({ decrypt: (v: string) => v, encrypt: (v: string) => `enc:${v}` }));

import {
  GMAIL_RECONNECT_REQUIRED_ERROR,
  GMAIL_REFRESH_TRANSIENT_ERROR,
  type GmailConnection,
  refreshAccessToken,
} from './email.service';

const connection = {
  id: 'conn-1',
  refresh_token_encrypted: 'refresh',
  access_token_encrypted: 'old',
  token_expires_at: new Date(Date.now() - 1000).toISOString(),
  status: 'connected',
} as unknown as GmailConnection;

let updates: Array<Record<string, unknown>>;
const supabase = {
  from: () => ({
    update: (payload: Record<string, unknown>) => {
      updates.push(payload);
      return { eq: () => Promise.resolve({ error: null }) };
    },
  }),
} as never;

const tokenError = (status: number, error?: string) =>
  new Response(JSON.stringify(error ? { error } : {}), { status });

describe('refreshAccessToken', () => {
  const env = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };

  beforeEach(() => {
    updates = [];
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.GOOGLE_CLIENT_ID = env.id;
    process.env.GOOGLE_CLIENT_SECRET = env.secret;
  });

  it('invalid_grant: marca a conexão com erro e pede reconexão (permanente)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenError(400, 'invalid_grant')));

    const r = await refreshAccessToken(connection, supabase);

    expect(r).toEqual({ error: GMAIL_RECONNECT_REQUIRED_ERROR });
    expect(updates).toEqual([{ status: 'error' }]);
  });

  it.each([
    ['500 do Google', tokenError(500)],
    ['503 do Google', tokenError(503, 'backend_error')],
    ['429 (limite)', tokenError(429, 'rate_limit_exceeded')],
    ['400 sem invalid_grant', tokenError(400, 'invalid_request')],
  ])('%s: erro passageiro, conexão continua como está', async (_label, response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const r = await refreshAccessToken(connection, supabase);

    expect(r).toEqual({ error: GMAIL_REFRESH_TRANSIENT_ERROR });
    expect(updates).toEqual([]);
  });

  it('falha de rede/timeout: erro passageiro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const r = await refreshAccessToken(connection, supabase);

    expect(r).toEqual({ error: GMAIL_REFRESH_TRANSIENT_ERROR });
    expect(updates).toEqual([]);
  });

  it('sucesso: grava o token novo e volta a connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'novo', expires_in: 3600 }), { status: 200 })),
    );

    const r = await refreshAccessToken(connection, supabase);

    expect(r).toEqual({ accessToken: 'novo' });
    expect(updates[0]).toMatchObject({ access_token_encrypted: 'enc:novo', status: 'connected' });
  });

  it('a mensagem do erro passageiro não casa com os padrões de erro permanente do motor', () => {
    const permanent = ['invalid', 'not found', 'not exist', 'disabled', 'suspended', 'blocked', 'bounce', 'spam', 'abuse', 'reconexão necessária'];
    const lower = GMAIL_REFRESH_TRANSIENT_ERROR.toLowerCase();
    expect(permanent.filter((p) => lower.includes(p))).toEqual([]);
    expect(GMAIL_RECONNECT_REQUIRED_ERROR.toLowerCase()).toContain('reconexão necessária');
  });
});
