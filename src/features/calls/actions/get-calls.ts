'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { CallRow } from '../types';
import { callFiltersSchema, type CallFilters } from '../schemas/call.schemas';

export interface CallListResult {
  data: CallRow[];
  total: number;
  page: number;
  per_page: number;
}

export async function getCalls(
  rawFilters: Record<string, unknown>,
): Promise<ActionResult<CallListResult>> {
  const parsed = callFiltersSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return { success: false, error: 'Filtros inválidos' };
  }
  const filters: CallFilters = parsed.data;

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const rangeFrom = (filters.page - 1) * filters.per_page;
  const to = rangeFrom + filters.per_page - 1;

  let query = from(supabase, 'calls')
    .select('*', { count: 'exact' })
    .eq('org_id', orgId);

  // Status filter
  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  // User filter
  if (filters.user_id) {
    query = query.eq('user_id', filters.user_id);
  }

  // Favorites / important
  if (filters.important_only) {
    query = query.eq('is_important', true);
  }

  // Period filter
  const now = new Date();
  if (filters.period === 'today') {
    // BRT midnight: shift "now" by -3h, truncate to date, shift back to get 03:00Z
    const nowBrt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const start = new Date(Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate()) + 3 * 60 * 60 * 1000).toISOString();
    query = query.gte('started_at', start);
  } else if (filters.period === 'week') {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    query = query.gte('started_at', start.toISOString());
  } else if (filters.period === 'month') {
    // BRT midnight of first day of month
    const nowBrt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const start = new Date(Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), 1) + 3 * 60 * 60 * 1000).toISOString();
    query = query.gte('started_at', start);
  }

  // Search (limited to origin + destination for performance, notes excluded from ILIKE)
  if (filters.search) {
    const term = filters.search.replace(/[%_]/g, '').substring(0, 50);
    if (term.length > 0) {
      query = query.or(
        `origin.ilike.%${term}%,destination.ilike.%${term}%`,
      );
    }
  }

  // Order and paginate
  query = query
    .order('started_at', { ascending: false })
    .range(rangeFrom, to);

  const { data, count, error } = (await query) as {
    data: Record<string, unknown>[] | null;
    count: number | null;
    error: { message: string } | null;
  };

  if (error) {
    return { success: false, error: 'Erro ao buscar ligações' };
  }

  return {
    success: true,
    data: {
      data: (data ?? []) as unknown as CallRow[],
      total: count ?? 0,
      page: filters.page,
      per_page: filters.per_page,
    },
  };
}
