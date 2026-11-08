import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
const svc = vi.hoisted(() => ({ ops: [] as Array<{ table: string; filters: Array<[string, unknown]> }> }));
let leadUpdateRows: unknown[] = [];

vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/handle-error', () => ({
  handleQueryError: (err: unknown) => (err ? { success: false, error: 'db error' } : null),
}));
vi.mock('./log-lead-event', () => ({ logLeadEvent: vi.fn() }));
vi.mock('@/features/cadences/services/webhook-dispatch.service', () => ({ dispatchWebhookEvent: vi.fn(() => Promise.resolve()) }));
vi.mock('@/features/notifications/services/notification.service', () => ({
  createNotificationsForOrgMembers: vi.fn(() => Promise.resolve()),
}));
vi.mock('../services/inbound-recovery.service', () => ({ scheduleInboundRecovery: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => ({ __svc: true }),
}));
vi.mock('@/lib/supabase/from', () => ({
  from: (client: { __svc?: boolean }, table: string) => {
    const op = { table, filters: [] as Array<[string, unknown]> };
    if (client.__svc) svc.ops.push(op);
    const chain: Record<string, unknown> = {};
    chain.update = () => chain;
    chain.insert = () => Promise.resolve({ error: null });
    chain.select = () => chain;
    chain.eq = (k: string, v: unknown) => {
      op.filters.push([k, v]);
      return chain;
    };
    chain.in = () => chain;
    chain.single = () => Promise.resolve({ data: { name: 'x' }, error: null });
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: client.__svc ? null : leadUpdateRows, error: null }).then(resolve);
    return chain;
  },
}));

import { archiveLead, markLeadAsLost } from './lead-lifecycle';

beforeEach(() => {
  svc.ops.length = 0;
  auth.getAuthOrgIdResult.mockResolvedValue({
    success: true,
    data: { orgId: 'org-A', userId: 'u1', supabase: { __svc: false } },
  });
});

describe('pista 11: lead de outra org', () => {
  it('archiveLead não toca o service-role quando o UPDATE sob RLS atinge 0 linhas', async () => {
    leadUpdateRows = [];
    const res = await archiveLead('lead-de-B');
    expect(res.success).toBe(false);
    expect(svc.ops).toHaveLength(0);
  });

  it('archiveLead filtra enrollments por org_id no service-role', async () => {
    leadUpdateRows = [{ id: 'lead-A' }];
    const res = await archiveLead('lead-A');
    expect(res.success).toBe(true);
    expect(svc.ops[0]?.table).toBe('cadence_enrollments');
    expect(svc.ops[0]?.filters).toContainEqual(['org_id', 'org-A']);
  });

  it('markLeadAsLost aborta antes do service-role se o lead não é da org', async () => {
    leadUpdateRows = [];
    const res = await markLeadAsLost('lead-de-B', 'reason');
    expect(res.success).toBe(false);
    expect(svc.ops).toHaveLength(0);
  });

  it('markLeadAsLost escopa enrollments e atividades por org_id', async () => {
    leadUpdateRows = [{ id: 'lead-A' }];
    const res = await markLeadAsLost('lead-A', 'reason');
    expect(res.success).toBe(true);
    const tables = svc.ops.map((o) => o.table);
    expect(tables).toEqual(['cadence_enrollments', 'scheduled_activities']);
    for (const o of svc.ops) expect(o.filters).toContainEqual(['org_id', 'org-A']);
  });
});
