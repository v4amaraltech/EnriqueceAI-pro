import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/get-org-id', () => ({ getAuthOrgIdResult: vi.fn() }));

let chainResult: { data: unknown; error: unknown };
let lastTable: string;
let lastOp: string;
const eqArgs: Array<[string, unknown]> = [];

function makeChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'upsert', 'delete', 'order']) {
    chain[m] = vi.fn((...args: unknown[]) => {
      if (m === 'upsert') lastOp = 'upsert';
      if (m === 'delete') lastOp = 'delete';
      void args;
      return chain;
    });
  }
  chain.eq = vi.fn((col: string, val: unknown) => {
    eqArgs.push([col, val]);
    return chain;
  });
  chain.single = vi.fn(() => Promise.resolve(chainResult));
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(chainResult).then(resolve);
  return chain;
}

const mockSupabase = {
  from: vi.fn((table: string) => {
    lastTable = table;
    return makeChain();
  }),
};

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import {
  deleteApolloSearch,
  listApolloSearches,
  saveApolloSearch,
} from './apollo-saved-searches';

const mockedAuth = vi.mocked(getAuthOrgIdResult);

const baseFilters = {
  titles: 'CEO',
  locations: 'São Paulo',
  keywords: '',
  domains: '',
  emailStatuses: ['verified'],
  industries: [],
  employeeRanges: ['11,50'],
  includeSimilarTitles: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  eqArgs.length = 0;
  chainResult = { data: null, error: null };
  mockedAuth.mockResolvedValue({
    success: true,
    data: { orgId: 'org-1', userId: 'user-1', supabase: mockSupabase },
  } as unknown as Awaited<ReturnType<typeof getAuthOrgIdResult>>);
});

describe('saveApolloSearch', () => {
  it('upserts and returns the id', async () => {
    chainResult = { data: { id: 'search-1' }, error: null };
    const r = await saveApolloSearch({ name: 'CEOs SP', filters: baseFilters });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.id).toBe('search-1');
    expect(lastTable).toBe('apollo_saved_searches');
    expect(lastOp).toBe('upsert');
  });

  it('rejects an empty name', async () => {
    const r = await saveApolloSearch({ name: '  ', filters: baseFilters });
    expect(r.success).toBe(false);
  });
});

describe('listApolloSearches', () => {
  it('returns the user own saved searches scoped by org+user', async () => {
    chainResult = { data: [{ id: 's1', name: 'A', filters: baseFilters }], error: null };
    const r = await listApolloSearches();
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveLength(1);
    expect(eqArgs).toContainEqual(['org_id', 'org-1']);
    expect(eqArgs).toContainEqual(['user_id', 'user-1']);
  });
});

describe('deleteApolloSearch', () => {
  it('rejects a non-uuid id', async () => {
    const r = await deleteApolloSearch('nope');
    expect(r.success).toBe(false);
  });

  it('deletes scoped by id + org + user', async () => {
    chainResult = { data: null, error: null };
    const r = await deleteApolloSearch('550e8400-e29b-41d4-a716-446655440000');
    expect(r.success).toBe(true);
    expect(lastOp).toBe('delete');
    expect(eqArgs).toContainEqual(['org_id', 'org-1']);
    expect(eqArgs).toContainEqual(['user_id', 'user-1']);
  });
});
