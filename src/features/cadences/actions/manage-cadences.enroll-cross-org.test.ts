import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/features/leads/actions/log-lead-event', () => ({ logLeadEvent: vi.fn(), logLeadEventBulk: vi.fn() }));
vi.mock('@/lib/actions/handle-error', () => ({
  handleQueryError: (err: unknown) => (err ? { success: false, error: 'db error' } : null),
}));

import { enrollLeads } from './manage-cadences';

const inserts: Array<Record<string, unknown>> = [];

function makeSupabase() {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.is = () => chain;
      chain.update = () => chain;
      chain.in = () => chain;
      chain.insert = (row: Record<string, unknown>) => {
        inserts.push(row);
        return Promise.resolve({ error: null });
      };
      chain.single = () => Promise.resolve({ data: { id: 'cad', name: 'C', status: 'active' }, error: null });
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === 'leads' ? [{ id: 'lead-A' }] : null, error: null }).then(resolve);
      return chain;
    },
  };
}

describe('pista 15: enrollLeads', () => {
  beforeEach(() => {
    inserts.length = 0;
    auth.getAuthOrgIdResult.mockResolvedValue({
      success: true,
      data: { orgId: 'org-A', userId: 'u1', supabase: makeSupabase() },
    });
  });

  it('só inscreve leads da org da sessão', async () => {
    const res = await enrollLeads('cad', ['lead-A', 'lead-de-B']);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.enrolled).toBe(1);
      expect(res.data.errors).toHaveLength(1);
    }
    expect(inserts.map((i) => i.lead_id)).toEqual(['lead-A']);
  });
});
