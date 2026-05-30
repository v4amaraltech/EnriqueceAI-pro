import { vi } from 'vitest';

export const mockSupabaseAuth = {
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  })),
};

// Default resolved value for terminal/awaited queries. Tests that need
// specific data override `mockSupabaseFrom` per-call with mockImplementation /
// mockReturnValueOnce and build their own chains.
const defaultResult = { data: null, error: null, count: null };

// Every PostgREST query-builder method that returns the builder itself (so
// calls can be chained in any order, matching the real supabase-js client).
const CHAINABLE_METHODS = [
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'like', 'ilike', 'is', 'in', 'contains', 'containedBy',
  'range', 'overlaps', 'match', 'not', 'or', 'filter',
  'order', 'limit', 'textSearch', 'returns', 'throwOnError',
  'abortSignal', 'csv', 'explain', 'rollback',
] as const;

/**
 * Build a chainable + thenable query-builder mock. Each chainable method is a
 * vi.fn() returning the same builder; `single`/`maybeSingle` resolve to
 * `{ data: null, error: null }`; the builder is awaitable (thenable) and
 * resolves to `{ data: null, error: null, count: null }`.
 */
export function createQueryBuilder() {
  const builder: Record<string, unknown> = {};

  for (const method of CHAINABLE_METHODS) {
    builder[method] = vi.fn(() => builder);
  }

  builder.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));

  // Thenable: `await from(...).select()...` resolves to the default result.
  builder.then = (
    resolve: (v: typeof defaultResult) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(defaultResult).then(resolve, reject);
  builder.catch = (reject: (e: unknown) => unknown) =>
    Promise.resolve(defaultResult).catch(reject);
  builder.finally = (cb: () => void) =>
    Promise.resolve(defaultResult).finally(cb);

  return builder;
}

// Accepts the table name (like the real client) so tests can route per-table
// via mockImplementation((table: string) => ...); the arg is unused by the
// default builder. Zero-arg implementations remain assignable to this signature.
export const mockSupabaseFrom = vi.fn((_table: string) => createQueryBuilder());

export const mockSupabase = {
  auth: mockSupabaseAuth,
  from: mockSupabaseFrom,
  rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
};

export function resetMocks() {
  vi.clearAllMocks();
}
