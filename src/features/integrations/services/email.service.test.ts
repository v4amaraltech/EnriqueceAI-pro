import { describe, expect, it, vi, beforeEach } from 'vitest';

import { EmailService } from './email.service';

// Mock supabase
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from '@/lib/supabase/server';

function buildQueryChain(gmailData: Record<string, unknown> | null) {
  const singleFn = () => Promise.resolve({ data: gmailData });
  const inFn = () => ({ single: singleFn });
  const eqChain = () => ({
    eq: eqChain,
    in: inFn,
    single: singleFn,
  });
  return { eq: eqChain, in: inFn, single: singleFn };
}

function mockSupabase(gmailData: Record<string, unknown> | null) {
  const updateMock = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue(Promise.resolve({ error: null })),
  });
  const supabase = {
    from: () => ({
      select: () => buildQueryChain(gmailData),
      update: updateMock,
    }),
    _updateMock: updateMock,
  };
  vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
  return supabase;
}

function createMockSupabaseClient(gmailData: Record<string, unknown> | null) {
  const updateMock = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue(Promise.resolve({ error: null })),
  });
  return {
    from: () => ({
      select: () => buildQueryChain(gmailData),
      update: updateMock,
    }),
  };
}

describe('EmailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('should return error when no Gmail connection found', async () => {
    mockSupabase(null);

    const result = await EmailService.sendEmail('user-1', 'org-1', {
      to: 'lead@example.com',
      subject: 'Test',
      htmlBody: '<p>Hello</p>',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Nenhuma conexão Gmail ativa encontrada');
  });

  it('should attempt auto-refresh when token is expired', async () => {
    mockSupabase({
      id: 'conn-1',
      access_token_encrypted: 'token',
      refresh_token_encrypted: 'refresh',
      token_expires_at: '2020-01-01T00:00:00Z',
      email_address: 'user@gmail.com',
      status: 'connected',
    });

    // No GOOGLE_CLIENT_ID/SECRET in test env → refresh fails gracefully
    const result = await EmailService.sendEmail('user-1', 'org-1', {
      to: 'lead@example.com',
      subject: 'Test',
      htmlBody: '<p>Hello</p>',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('OAuth não configurado');
  });

  it('should auto-refresh expired token and send email', async () => {
    // Temporarily set env vars for this test
    const origClientId = process.env.GOOGLE_CLIENT_ID;
    const origClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

    // Need to re-import to pick up env vars — but module-level consts are cached.
    // Instead, use injected supabaseClient to avoid createServerSupabaseClient.
    const mockClient = createMockSupabaseClient({
      id: 'conn-1',
      access_token_encrypted: 'old-expired-token',
      refresh_token_encrypted: 'valid-refresh-token',
      token_expires_at: '2020-01-01T00:00:00Z',
      email_address: 'user@gmail.com',
      status: 'connected',
    });

    // fetch calls: 1st = Google refresh, 2nd = signature, 3rd = Gmail send, 4th = threadId
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'new-fresh-token', expires_in: 3600 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'msg-refreshed' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ threadId: 'thread-1' }),
      } as Response);

    const result = await EmailService.sendEmail(
      'user-1',
      'org-1',
      { to: 'lead@example.com', subject: 'Test', htmlBody: '<p>Hello</p>' },
      undefined,
      mockClient as never,
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-refreshed');

    // Verify the Gmail send used the new token (calls: refresh, signature, send, threadId)
    const sendCall = vi.mocked(global.fetch).mock.calls[2]!;
    expect(sendCall[1]?.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer new-fresh-token' }),
    );

    // Restore env
    process.env.GOOGLE_CLIENT_ID = origClientId;
    process.env.GOOGLE_CLIENT_SECRET = origClientSecret;
  });

  it('should send email successfully via Gmail API', async () => {
    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    mockSupabase({
      id: 'conn-1',
      access_token_encrypted: 'valid-token',
      refresh_token_encrypted: 'refresh',
      token_expires_at: futureDate,
      email_address: 'user@gmail.com',
      status: 'connected',
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'msg-123' }),
    } as Response);

    const result = await EmailService.sendEmail('user-1', 'org-1', {
      to: 'lead@example.com',
      subject: 'Test Email',
      htmlBody: '<p>Hello World</p>',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer valid-token',
        }),
      }),
    );
  });

  it('should use injected supabaseClient when provided', async () => {
    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    const mockClient = createMockSupabaseClient({
      id: 'conn-1',
      access_token_encrypted: 'injected-token',
      refresh_token_encrypted: 'refresh',
      token_expires_at: futureDate,
      email_address: 'user@gmail.com',
      status: 'connected',
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'msg-injected' }),
    } as Response);

    const result = await EmailService.sendEmail(
      'user-1',
      'org-1',
      { to: 'lead@example.com', subject: 'Test', htmlBody: '<p>Hello</p>' },
      undefined,
      mockClient as never,
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-injected');
    // createServerSupabaseClient should NOT have been called
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it('should handle Gmail API errors', async () => {
    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    mockSupabase({
      id: 'conn-1',
      access_token_encrypted: 'valid-token',
      refresh_token_encrypted: 'refresh',
      token_expires_at: futureDate,
      email_address: 'user@gmail.com',
      status: 'connected',
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: { message: 'Rate limit exceeded' } }),
    } as Response);

    const result = await EmailService.sendEmail('user-1', 'org-1', {
      to: 'lead@example.com',
      subject: 'Test',
      htmlBody: '<p>Hello</p>',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Rate limit exceeded');
  });

  it('should inject open tracking pixel when interactionId provided', async () => {
    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    mockSupabase({
      id: 'conn-1',
      access_token_encrypted: 'valid-token',
      refresh_token_encrypted: 'refresh',
      token_expires_at: futureDate,
      email_address: 'user@gmail.com',
      status: 'connected',
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'msg-456' }),
    } as Response);

    await EmailService.sendEmail(
      'user-1',
      'org-1',
      {
        to: 'lead@example.com',
        subject: 'Tracked Email',
        htmlBody: '<html><body><p>Hello</p></body></html>',
        trackOpens: true,
      },
      'interaction-123',
    );

    expect(global.fetch).toHaveBeenCalled();
    const calls = vi.mocked(global.fetch).mock.calls;
    // calls: [0]=signature, [1]=send, [2]=threadId
    const fetchCall = calls[1]!;
    const body = JSON.parse(fetchCall[1]?.body as string) as { raw: string };
    // Decode the outer base64url to get the MIME message
    const mimeMessage = Buffer.from(body.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    // The MIME message contains two base64 parts: text/plain then text/html — extract the HTML one
    const base64Match = mimeMessage.match(/Content-Type: text\/html[^\r]*\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=]+)\r\n--/);
    expect(base64Match).toBeTruthy();
    const htmlBody = Buffer.from(base64Match![1]!, 'base64').toString();
    expect(htmlBody).toContain('/api/track/open/interaction-123');
  });
});
