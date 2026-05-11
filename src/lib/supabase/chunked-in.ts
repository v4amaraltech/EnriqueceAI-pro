/**
 * Run a Supabase query against many IDs in safe-sized chunks and merge the
 * rows. PostgREST enforces a hard URL ceiling around 4-8KB — passing a few
 * hundred UUIDs to `.in()` silently returns no rows on production, which has
 * caused dashboard cards to collapse to 0% (see fix in
 * src/features/dashboard/actions/get-response-time.ts).
 *
 * The callback builds the query for a single chunk; the helper iterates and
 * concatenates the results. Errors from any chunk are logged via the
 * provided callback so callers don't have to know how many chunks ran.
 *
 * Usage:
 *   const rows = await chunkedIn(leadIds, (chunk) =>
 *     from(supabase, 'interactions')
 *       .select('lead_id, created_at')
 *       .eq('org_id', orgId)
 *       .in('lead_id', chunk),
 *   );
 */
export const CHUNKED_IN_DEFAULT_SIZE = 200;

export async function chunkedIn<T>(
  ids: readonly string[],
  buildQuery: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
  chunkSize: number = CHUNKED_IN_DEFAULT_SIZE,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize) as string[];
    const { data } = await buildQuery(chunk);
    if (data) out.push(...data);
  }
  return out;
}
