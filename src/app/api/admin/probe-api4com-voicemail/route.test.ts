import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

vi.mock('@/lib/supabase/from', () => ({
  from: (client: { from: (t: string) => unknown }, table: string) => client.from(table),
}));

vi.mock('@/lib/auth/verify-service-role', () => ({
  verifyServiceRole: () => true,
}));

vi.mock('@/lib/security/encryption', () => ({
  decrypt: () => 'api-key',
}));

import { POST } from './route';

function connectionsChain() {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue({
    data: [{ user_id: 'user-1', ramal: '1024', api_key_encrypted: 'enc', base_url: 'https://api.api4com.com/api/v1/' }],
  });
  return c;
}

describe('probe-api4com-voicemail', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation(() => connectionsChain());
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [], meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The window is 01–17/mai/2026 in Brasília days. In API4COM's clock that is
  // exactly 2026-05-01T00:00Z .. 2026-05-17T23:59:59Z — the values the probe
  // always sent; the conversion must keep them.
  it('filters mai/2026 Brasília days in the API4COM clock', async () => {
    const res = await POST(
      new Request('https://example.com/api/admin/probe-api4com-voicemail', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: 'org-1' }),
      }),
    );

    expect(res.status).toBe(200);
    const windows = fetchMock.mock.calls
      .map(([url]) => new URL(url as string).searchParams.get('filter'))
      .filter((f): f is string => f !== null)
      .map((f) => (JSON.parse(f) as { where: { started_at?: { gte: string; lte: string } } }).where.started_at)
      .filter((w) => w !== undefined);

    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(w).toEqual({ gte: '2026-05-01T00:00:00.000Z', lte: '2026-05-17T23:59:59.000Z' });
    }
  });
});
