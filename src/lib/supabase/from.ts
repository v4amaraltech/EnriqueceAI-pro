import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './types';

/**
 * Typed wrapper for supabase.from() — avoids the verbose
 * `as ReturnType<typeof supabase.from>` cast on every query.
 *
 * The return type is intentionally loose (generic PostgrestQueryBuilder)
 * because callers use outer `as { data: T }` casts on query results.
 */
export function from(
  supabase: SupabaseClient<Database>,
  table: string,
) {
  return supabase.from(table as any) as ReturnType<SupabaseClient<Database>['from']>;
}
