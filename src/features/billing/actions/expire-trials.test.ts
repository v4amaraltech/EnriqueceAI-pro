import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateNotificationsForOrgMembers = vi.fn();

vi.mock('@/features/notifications/services/notification.service', () => ({
  createNotificationsForOrgMembers: (...args: unknown[]) =>
    mockCreateNotificationsForOrgMembers(...args),
}));

// Build a fluent mock chain for Supabase
function makeChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {};
  const terminal = vi.fn().mockResolvedValue(resolvedValue);

  chain.select = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.lt = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = terminal;
  chain.maybeSingle = terminal;

  // Make thenable for await
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(resolvedValue).then(resolve, reject);

  return chain;
}

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

import { expireTrialsCron } from './expire-trials';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('expireTrialsCron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expires trials and returns count', async () => {
    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      const responses = [
        // 1. Update expired trials
        { data: [{ org_id: 'org-1' }, { org_id: 'org-2' }], error: null },
        // 2. Query trials expiring in ~7 days
        { data: [], error: null },
      ];
      const value = responses[Math.min(callIndex, responses.length - 1)];
      callIndex++;
      return makeChain(value);
    });

    const result = await expireTrialsCron();

    expect(result.expired).toBe(2);
    expect(result.notified).toBe(0);
  });

  it('sends notifications for trials expiring in 7 days', async () => {
    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      const responses = [
        // 1. Update expired trials
        { data: [], error: null },
        // 2. Query trials expiring in ~7 days
        { data: [{ org_id: 'org-3' }], error: null },
        // 3. Dedup check — no existing notification
        { data: [], error: null },
      ];
      const value = responses[Math.min(callIndex, responses.length - 1)];
      callIndex++;
      return makeChain(value);
    });

    const result = await expireTrialsCron();

    expect(result.expired).toBe(0);
    expect(result.notified).toBe(1);
    expect(mockCreateNotificationsForOrgMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-3',
        type: 'trial_expiring',
        roleFilter: 'manager',
      }),
    );
  });

  it('skips notification if already sent today (dedup)', async () => {
    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      const responses = [
        // 1. Update expired trials
        { data: [], error: null },
        // 2. Query trials expiring in ~7 days
        { data: [{ org_id: 'org-4' }], error: null },
        // 3. Dedup check — already notified
        { data: [{ id: 'notif-existing' }], error: null },
      ];
      const value = responses[Math.min(callIndex, responses.length - 1)];
      callIndex++;
      return makeChain(value);
    });

    const result = await expireTrialsCron();

    expect(result.notified).toBe(0);
    expect(mockCreateNotificationsForOrgMembers).not.toHaveBeenCalled();
  });

  it('handles no expired trials and no expiring trials', async () => {
    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      const responses = [
        // 1. Update expired trials
        { data: [], error: null },
        // 2. Query trials expiring in ~7 days
        { data: [], error: null },
      ];
      const value = responses[Math.min(callIndex, responses.length - 1)];
      callIndex++;
      return makeChain(value);
    });

    const result = await expireTrialsCron();

    expect(result.expired).toBe(0);
    expect(result.notified).toBe(0);
  });

  it('throws when expire query fails', async () => {
    mockFrom.mockImplementation(() => {
      return makeChain({ data: null, error: { message: 'DB error' } });
    });

    await expect(expireTrialsCron()).rejects.toThrow('Failed to expire trials: DB error');
  });
});
