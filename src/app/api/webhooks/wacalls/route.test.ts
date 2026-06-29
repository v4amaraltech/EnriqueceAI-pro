import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

vi.mock('@/lib/supabase/from', () => ({
  from: (client: { from: (t: string) => unknown }, table: string) => client.from(table),
}));

import { POST } from './route';

function chain(maybeSingleResult: unknown) {
  const c: Record<string, unknown> = {};
  c.upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  c.update = vi.fn().mockReturnValue(c);
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.maybeSingle = vi.fn().mockResolvedValue(maybeSingleResult);
  return c;
}

function req(body: unknown, secret?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret) headers['x-webhook-secret'] = secret;
  return new Request('https://example.com/api/webhooks/wacalls', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('wacalls recording webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WACALLS_WEBHOOK_SECRET = 'top-secret';
  });
  afterEach(() => {
    delete process.env.WACALLS_WEBHOOK_SECRET;
  });

  it('returns 503 when the secret is not configured', async () => {
    delete process.env.WACALLS_WEBHOOK_SECRET;
    const res = await POST(req({ service_call_id: 'c1', recording_url: 'https://r' }, 'top-secret'));
    expect(res.status).toBe(503);
  });

  it('returns 401 on a wrong secret', async () => {
    const res = await POST(req({ service_call_id: 'c1', recording_url: 'https://r' }, 'wrong'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(req({ service_call_id: 'c1' }, 'top-secret'));
    expect(res.status).toBe(400);
  });

  it('buffers the recording when the call does not exist yet', async () => {
    const c = chain({ data: null });
    mockFrom.mockReturnValue(c);

    const res = await POST(req({ service_call_id: 'c1', recording_url: 'https://r/rec.mp3' }, 'top-secret'));
    const json = (await res.json()) as { buffered?: boolean };

    expect(res.status).toBe(200);
    expect(json.buffered).toBe(true);
    expect(c.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ service_call_id: 'c1', recording_url: 'https://r/rec.mp3' }),
      expect.objectContaining({ onConflict: 'service_call_id' }),
    );
  });

  it('links the recording to an existing call that has none', async () => {
    const bufferChain = chain({ data: null });
    const callChain = chain({ data: { id: 'call-1', recording_url: null } });
    let n = 0;
    mockFrom.mockImplementation(() => {
      n += 1;
      return n === 1 ? bufferChain : callChain;
    });

    const res = await POST(req({ service_call_id: 'c1', recording_url: 'https://r/rec.mp3' }, 'top-secret'));
    const json = (await res.json()) as { linked?: boolean };

    expect(res.status).toBe(200);
    expect(json.linked).toBe(true);
    expect(callChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ recording_url: 'https://r/rec.mp3' }),
    );
  });
});
