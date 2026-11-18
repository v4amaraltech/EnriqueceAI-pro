import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmailHealthRow } from './email-health.logic';

const mocks = vi.hoisted(() => ({
  connections: [] as Array<Record<string, unknown>>,
  recentAlerts: new Set<string>(),
  rows: [] as EmailHealthRow[],
  createNotification: vi.fn().mockResolvedValue({ id: 'n1' }),
  createNotificationsForOrgMembers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/notifications/services/notification.service', () => ({
  createNotification: mocks.createNotification,
  createNotificationsForOrgMembers: mocks.createNotificationsForOrgMembers,
}));

vi.mock('./email-health.service', () => ({
  readEmailHealthRows: vi.fn(async () => mocks.rows),
}));

/** Minimal PostgREST chain: gmail_connections list + notifications cooldown lookup. */
vi.mock('@/lib/supabase/from', () => ({
  from: (_client: unknown, table: string) => {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      in: () => chain,
      gte: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({
        data: mocks.recentAlerts.has(String(filters.resource_id)) ? { id: 'old' } : null,
      }),
      then: (resolve: (v: unknown) => unknown) =>
        resolve(table === 'gmail_connections' ? { data: mocks.connections, error: null } : { data: [], error: null }),
    };
    return chain;
  },
}));

import { bounceResourceId, checkMailboxAlerts, disconnectedResourceId } from './email-health-alerts';

const NOW = new Date('2026-11-18T14:00:00Z');
const CUTOFF = '2026-11-17T14:00:00Z';

function sent(lead: string, sender = 'sdr-a'): EmailHealthRow {
  return {
    type: 'sent',
    lead_id: lead,
    cadence_id: 'cad',
    created_at: '2026-11-17T13:00:00Z',
    external_id: 'g',
    manual_send: null,
    meeting_reminder: null,
    source: null,
    sender_user_id: sender,
    performed_by: null,
    error: null,
    reason: null,
  };
}

function bounced(lead: string): EmailHealthRow {
  return { ...sent(lead), type: 'bounced', external_id: null, sender_user_id: null };
}

beforeEach(() => {
  mocks.connections = [];
  mocks.recentAlerts = new Set();
  mocks.rows = [];
  mocks.createNotification.mockClear();
  mocks.createNotificationsForOrgMembers.mockClear();
});

describe('checkMailboxAlerts — Gmail desconectado', () => {
  const conn = { id: 'c1', org_id: 'org', user_id: 'sdr-a', email_address: 'a@x.com', status: 'error', paused_reason: null };

  it('notifies the owner and the managers (without the owner twice)', async () => {
    mocks.connections = [conn];
    const out = await checkMailboxAlerts({} as never, NOW, CUTOFF);

    expect(out.disconnected).toEqual([{ connection_id: 'c1', alerted: true }]);
    expect(mocks.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'sdr-a', resource_type: 'mailbox', resource_id: disconnectedResourceId('c1') }),
    );
    expect(mocks.createNotificationsForOrgMembers).toHaveBeenCalledWith(
      expect.objectContaining({ roleFilter: 'manager', excludeUserId: 'sdr-a', resourceId: disconnectedResourceId('c1') }),
    );
  });

  it('does not repeat within 24h', async () => {
    mocks.connections = [conn];
    mocks.recentAlerts.add(disconnectedResourceId('c1'));
    const out = await checkMailboxAlerts({} as never, NOW, CUTOFF);

    expect(out.disconnected).toEqual([{ connection_id: 'c1', alerted: false }]);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });
});

describe('checkMailboxAlerts — bounce alto', () => {
  const conn = { id: 'c2', org_id: 'org', user_id: 'sdr-a', email_address: 'a@x.com', status: 'connected', paused_reason: null };
  const leads = Array.from({ length: 40 }, (_, i) => `l${i}`);

  it('alerts managers above 5% with at least 30 leads', async () => {
    mocks.connections = [conn];
    mocks.rows = [...leads.map((l) => sent(l)), bounced('l0'), bounced('l1'), bounced('l2')]; // 7.5%
    const out = await checkMailboxAlerts({} as never, NOW, CUTOFF);

    expect(out.high_bounce).toEqual([{ connection_id: 'c2', rate: 7.5, leads: 40, alerted: true }]);
    expect(mocks.createNotificationsForOrgMembers).toHaveBeenCalledWith(
      expect.objectContaining({ roleFilter: 'manager', resourceId: bounceResourceId('c2') }),
    );
  });

  it('stays quiet at or below 5%, with a small sample, or for a paused mailbox', async () => {
    mocks.connections = [conn];
    mocks.rows = [...leads.map((l) => sent(l)), bounced('l0'), bounced('l1')]; // 5%
    expect((await checkMailboxAlerts({} as never, NOW, CUTOFF)).high_bounce).toEqual([]);

    mocks.rows = [...leads.slice(0, 20).map((l) => sent(l)), bounced('l0'), bounced('l1'), bounced('l2')];
    expect((await checkMailboxAlerts({} as never, NOW, CUTOFF)).high_bounce).toEqual([]);

    mocks.connections = [{ ...conn, paused_reason: 'bounce 6%' }];
    mocks.rows = [...leads.map((l) => sent(l)), bounced('l0'), bounced('l1'), bounced('l2')];
    expect((await checkMailboxAlerts({} as never, NOW, CUTOFF)).high_bounce).toEqual([]);
    expect(mocks.createNotificationsForOrgMembers).not.toHaveBeenCalled();
  });

  it('does not repeat within 24h', async () => {
    mocks.connections = [conn];
    mocks.recentAlerts.add(bounceResourceId('c2'));
    mocks.rows = [...leads.map((l) => sent(l)), bounced('l0'), bounced('l1'), bounced('l2')];
    const out = await checkMailboxAlerts({} as never, NOW, CUTOFF);

    expect(out.high_bounce[0]?.alerted).toBe(false);
    expect(mocks.createNotificationsForOrgMembers).not.toHaveBeenCalled();
  });
});
