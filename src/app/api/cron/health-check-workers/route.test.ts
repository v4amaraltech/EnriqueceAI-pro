import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };
const mockNotify = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

vi.mock('@/lib/supabase/from', () => ({
  from: (client: { from: (t: string) => unknown }, table: string) => client.from(table),
}));

vi.mock('@/lib/auth/verify-cron-secret', () => ({
  verifyCronSecret: () => true,
}));

vi.mock('@/features/notifications/services/notification.service', () => ({
  createNotificationsForOrgMembers: (params: unknown) => mockNotify(params),
}));

import { POST } from './route';

/** Chainable query builder whose terminal calls resolve to `result`. */
function chain(result: Record<string, unknown>) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'like', 'gte', 'lte', 'limit']) c[m] = vi.fn().mockReturnValue(c);
  c.maybeSingle = vi.fn().mockResolvedValue(result);
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

function setup(opts: { dialerCalls: number; recentAlert?: boolean }) {
  const callsChain = chain({ count: opts.dialerCalls });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'worker_run_state') {
      return chain({
        data: {
          last_run_at: '2026-09-10T17:00:00.000Z', // qui 14:00 BRT
          last_success_at: new Date().toISOString(), // healthy for the stale check
          last_status: 'success',
          metadata: {
            windowHours: 1.5,
            orgs: [
              { org_id: 'julio', fetched: 0, errors: 0 },
              { org_id: 'amaral', fetched: 132, errors: 0 },
            ],
          },
        },
      });
    }
    if (table === 'calls') return callsChain;
    if (table === 'notifications') return chain({ data: opts.recentAlert ? { id: 'n1' } : null });
    return chain({ data: [] });
  });
  return { callsChain };
}

const request = () => new Request('https://example.com/api/cron/health-check-workers', { method: 'POST' });

describe('health-check-workers — reconcile fetched: 0', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotify.mockResolvedValue(undefined);
  });

  it('alerts only the org that came back empty while the dialer kept calling', async () => {
    const { callsChain } = setup({ dialerCalls: 12 });

    const res = await POST(request());
    const json = (await res.json()) as { zero_fetch: Array<{ org_id: string; suspect: boolean; alerted: boolean }> };

    expect(json.zero_fetch).toEqual([{ org_id: 'julio', dialer_calls: 12, suspect: true, alerted: true }]);
    expect(callsChain.eq).toHaveBeenCalledWith('org_id', 'julio');
    expect(callsChain.like).toHaveBeenCalledWith('metadata->>gateway', 'flux-%');
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'julio',
        type: 'integration_error',
        resourceId: 'reconcile-api4com-calls:zero-fetch',
        roleFilter: 'manager',
      }),
    );
  });

  it('does not alert when the dialer was idle (holiday, no calls)', async () => {
    setup({ dialerCalls: 2 });

    const res = await POST(request());
    const json = (await res.json()) as { zero_fetch: Array<{ suspect: boolean; alerted: boolean }> };

    expect(json.zero_fetch).toEqual([{ org_id: 'julio', dialer_calls: 2, suspect: false, alerted: false }]);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('respects the 24h cooldown', async () => {
    setup({ dialerCalls: 12, recentAlert: true });

    const res = await POST(request());
    const json = (await res.json()) as { zero_fetch: Array<{ suspect: boolean; alerted: boolean }> };

    expect(json.zero_fetch).toEqual([{ org_id: 'julio', dialer_calls: 12, suspect: true, alerted: false }]);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
