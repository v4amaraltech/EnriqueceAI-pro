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

vi.mock('@/features/calls/services/api4com-classification', () => ({
  classifyApi4ComCall: () => ({ status: 'not_connected', connected: false }),
  getSignificantThreshold: () => Promise.resolve(50),
}));

import { POST } from './route';

/** Thenable chain for the api4com_connections lookup. */
function connectionsChain() {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.not = vi.fn().mockReturnValue(c);
  c.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({
      data: [{ user_id: 'user-1', ramal: '1024', api_key_encrypted: 'enc', base_url: 'https://api.api4com.com/api/v1/' }],
    }).then(resolve);
  return c;
}

function req(body: unknown) {
  return new Request('https://example.com/api/admin/backfill-missing-voicemails', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  orgId: 'org-1',
  ramals: ['1024'],
  hangupCause: 'NUMBER_CHANGED',
};

describe('backfill-missing-voicemails', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation(() => connectionsChain());
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [], meta: { totalPageCount: 1, nextPage: null } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the window in the API4COM clock (real UTC − 3h)', async () => {
    const res = await POST(
      req({ ...baseBody, sinceIso: '2026-09-10T15:00:00.000Z', untilIso: '2026-09-10T18:00:00.000Z' }),
    );

    expect(res.status).toBe(200);
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    const filter = JSON.parse(url.searchParams.get('filter')!) as {
      where: { from: string; hangup_cause: string; started_at: { gte: string; lte: string } };
    };
    expect(filter.where).toEqual({
      from: '1024',
      hangup_cause: 'NUMBER_CHANGED',
      started_at: { gte: '2026-09-10T12:00:00.000Z', lte: '2026-09-10T15:00:00.000Z' },
    });
  });

  it('rejects invalid or inverted dates without calling API4COM', async () => {
    const invalid = await POST(req({ ...baseBody, sinceIso: 'ontem', untilIso: '2026-09-10T18:00:00.000Z' }));
    const inverted = await POST(
      req({ ...baseBody, sinceIso: '2026-09-10T18:00:00.000Z', untilIso: '2026-09-10T15:00:00.000Z' }),
    );

    expect(invalid.status).toBe(400);
    expect(inverted.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
