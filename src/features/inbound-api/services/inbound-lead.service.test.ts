import { beforeEach, describe, expect, it, vi } from 'vitest';

import { from } from '@/lib/supabase/from';

import { ingestInboundLeads } from './inbound-lead.service';

// Mock the supabase query wrapper and the fire-and-forget side effects so the
// test exercises the dedup logic without touching a real DB.
vi.mock('@/lib/supabase/from', () => ({ from: vi.fn() }));
vi.mock('@/features/leads/actions/log-lead-event', () => ({ logLeadEvent: vi.fn() }));
vi.mock('@/features/cadences/services/webhook-dispatch.service', () => ({
  dispatchWebhookEvent: vi.fn(() => Promise.resolve()),
}));

const CHAINABLE = [
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'ilike', 'like', 'is', 'in', 'order', 'limit',
] as const;

/** Build a chainable query-builder whose `single`/`maybeSingle` resolve `terminal`. */
function makeBuilder(terminal: unknown) {
  const b: Record<string, unknown> = {};
  for (const m of CHAINABLE) b[m] = vi.fn(() => b);
  b.single = vi.fn(() => Promise.resolve(terminal));
  b.maybeSingle = vi.fn(() => Promise.resolve(terminal));
  b.then = (resolve: (v: unknown) => unknown) => resolve(terminal);
  return b;
}

const fromMock = vi.mocked(from);

const baseLead = {
  first_name: 'Carlos',
  email: 'carlos@empresa.com',
  telefone: '+5511999999999',
  empresa: 'XPTO',
};

const options = {
  orgId: 'org-1',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: {} as any,
  defaultSource: 'webhook' as const,
  onDuplicate: 'skip' as const,
};

beforeEach(() => {
  fromMock.mockReset();
});

describe('ingestInboundLeads — intra-batch dedup', () => {
  it('does not insert twice when the same email appears twice in one batch', async () => {
    fromMock
      // checkLeadLimitForOrg → no subscription → allowed
      .mockReturnValueOnce(makeBuilder({ data: null }) as never)
      // lead 0: findExistingLeadId (email) → not found
      .mockReturnValueOnce(makeBuilder({ data: null }) as never)
      // lead 0: insert → created
      .mockReturnValueOnce(makeBuilder({ data: { id: 'lead-1' }, error: null }) as never);

    const result = await ingestInboundLeads([{ ...baseLead }, { ...baseLead }], options);

    expect(result.created).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.results[1]).toMatchObject({ status: 'duplicate', existing_lead_id: 'lead-1' });
    // 3 queries only: limit check + 1 find + 1 insert. The 2nd lead dedups
    // in-memory, so there is NO 2nd insert.
    expect(fromMock).toHaveBeenCalledTimes(3);
  });
});

describe('ingestInboundLeads — concurrent race (unique violation)', () => {
  it('treats a 23505 unique violation as a duplicate instead of an error', async () => {
    fromMock
      // checkLeadLimitForOrg → allowed
      .mockReturnValueOnce(makeBuilder({ data: null }) as never)
      // findExistingLeadId (pre-insert) → not found
      .mockReturnValueOnce(makeBuilder({ data: null }) as never)
      // insert → unique violation (another request won the race)
      .mockReturnValueOnce(makeBuilder({ data: null, error: { code: '23505' } }) as never)
      // race fallback findExistingLeadId → now resolves the winner
      .mockReturnValueOnce(makeBuilder({ data: { id: 'raced-1' } }) as never);

    const result = await ingestInboundLeads([{ ...baseLead }], options);

    expect(result.created).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.results[0]).toMatchObject({ status: 'duplicate', existing_lead_id: 'raced-1' });
  });
});
