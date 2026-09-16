'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { logQueryError } from '@/lib/supabase/log-query-error';
import { sanitizeFilterValue } from '@/lib/supabase/sanitize-filter';

import type { LeadListResult } from '../leads.contract';
import type { LeadFilters } from '../schemas/lead.schemas';
import { leadFiltersSchema } from '../schemas/lead.schemas';
import { createdAtRange } from '../utils/created-at-range';

// Build the PostgREST `or` clauses for one search term. CNPJ is stored
// digits-only, so a punctuated query like "08.942.835/0001-72" never matches
// `cnpj.ilike`. We additionally search the normalized digits against cnpj so
// the SDR can paste a formatted CNPJ and still find the lead.
function searchClausesForTerm(rawTerm: string, fields: readonly string[]): string[] {
  // Strip PostgREST filter metacharacters (comma, parens, backslash) so a term
  // like "x,status.eq.won" can't inject an extra OR condition into the clause.
  const term = sanitizeFilterValue(rawTerm);
  const clauses = fields.map((field) => `${field}.ilike.%${term}%`);
  const digits = term.replace(/\D/g, '');
  if (digits.length >= 3 && digits !== term) {
    clauses.push(`cnpj.ilike.%${digits}%`);
  }
  return clauses;
}

export async function fetchLeads(
  rawFilters: Record<string, unknown>,
): Promise<ActionResult<LeadListResult>> {
  // Validate filters
  const parsed = leadFiltersSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return { success: false, error: 'Filtros inválidos' };
  }
  const filters: LeadFilters = parsed.data;

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const rangeFrom = (filters.page - 1) * filters.per_page;
  const to = rangeFrom + filters.per_page - 1;

  // When searching by text, skip other filters so the SDR always finds the lead
  const hasSearch = !!filters.search?.trim();

  // Source table: switch to the leads_no_active_enrollment view when filtering
  // "Sem cadência" — pushes the anti-join into SQL and avoids a 1k+ UUID IN()
  // clause that exceeds the PostgREST URL limit.
  const sourceTable =
    !hasSearch && filters.cadence_id === '__none__'
      ? 'leads_no_active_enrollment'
      : 'leads';

  // Cadence-specific filter uses an embedded inner join for the same reason:
  // an `.in('id', [700+ uuids])` list blows past the PostgREST URL limit and
  // the request fails with 400 (cadências grandes como a Recovery).
  const filterByCadence =
    !hasSearch && !!filters.cadence_id && filters.cadence_id !== '__none__';

  // Build query
  let query = from(supabase, sourceTable)
    .select(filterByCadence ? '*, cadence_enrollments!inner(cadence_id)' : '*', {
      count: 'exact',
    })
    .eq('org_id', orgId)
    .is('deleted_at', null);

  // Apply filters (skipped when searching)
  if (!hasSearch && filters.status) {
    query = query.eq('status', filters.status);
  }
  if (!hasSearch && filters.enrichment_status) {
    query = query.eq('enrichment_status', filters.enrichment_status);
  }
  if (!hasSearch && filters.porte) {
    query = query.eq('porte', filters.porte);
  }
  if (!hasSearch && filters.cnae) {
    query = query.ilike('cnae', `${filters.cnae}%`);
  }
  if (!hasSearch && filters.uf) {
    query = query.eq('endereco->>uf', filters.uf);
  }
  if (filters.assigned_to) {
    if (filters.assigned_to === '__unassigned__') {
      query = query.is('assigned_to', null);
    } else {
      query = query.eq('assigned_to', filters.assigned_to);
    }
  }
  if (!hasSearch && filters.lead_source) {
    query = query.eq('lead_source', filters.lead_source);
  }
  if (!hasSearch && filters.canal) {
    query = query.eq('canal', filters.canal);
  }
  if (!hasSearch && filters.loss_reason_id && filters.loss_reason_id.length > 0) {
    query = query.in('loss_reason_id', filters.loss_reason_id);
  }
  // "Criado em" — dias BRT convertidos em cortes ISO UTC (ver createdAtRange)
  const createdRange = hasSearch ? null : createdAtRange(filters);
  if (createdRange?.gte) query = query.gte('created_at', createdRange.gte);
  if (createdRange?.lte) query = query.lte('created_at', createdRange.lte);

  // Filter by cadence enrollment (skipped when searching).
  // The "__none__" case is handled at the source-table level (view above);
  // a specific cadence filters through the embedded inner join declared in the
  // select above, keeping the whole thing in SQL.
  if (filterByCadence) {
    query = query
      .eq('cadence_enrollments.cadence_id', filters.cadence_id!)
      .in('cadence_enrollments.status', ['active', 'paused']);
  }

  // Full-text search — every term in the query string must appear in some
  // searchable field (AND between terms, OR between fields for each term).
  //
  // Before: OR across every (term, field) pair, which made short stopwords
  // dominate the result set ("Saude da Mente" matched any lead containing
  // "da" — "Dasneves nutrição animal", "FARIA DE SOUZA", etc.).
  //
  // Stopwords with <3 chars are dropped so "da", "de", "do" don't force
  // exact-substring matches that miss legitimate hits.
  if (filters.search) {
    const searchFields = ['razao_social', 'nome_fantasia', 'cnpj', 'first_name', 'last_name', 'email'];
    const allTerms = filters.search.replace(/[%_]/g, '').trim().split(/\s+/).filter(Boolean);
    const terms = allTerms.filter((t) => t.length >= 3);
    // If the entire query is short (e.g. "AI"), use what we have rather than searching everything.
    const effectiveTerms = terms.length > 0 ? terms : allTerms;
    for (const term of effectiveTerms) {
      query = query.or(searchClausesForTerm(term, searchFields).join(','));
    }
  }

  // Order and paginate
  const ascending = filters.sort_dir === 'asc';
  query = query
    .order(filters.sort_by, { ascending, nullsFirst: false })
    .range(rangeFrom, to);

  const { data, count, error } = (await query) as {
    data: Record<string, unknown>[] | null;
    count: number | null;
    error: { message: string } | null;
  };

  if (error) {
    logQueryError(error, 'fetchLeads', { orgId, filters });
    return { success: false, error: 'Erro ao buscar leads' };
  }

  return {
    success: true,
    data: {
      data: (data ?? []) as unknown as LeadListResult['data'],
      total: count ?? 0,
      page: filters.page,
      per_page: filters.per_page,
    },
  };
}

export interface LeadStatusCounts {
  all: number;
  new: number;
  contacted: number;
  qualified: number;
  won: number;
  unqualified: number;
  archived: number;
}

export async function fetchLeadStatusCounts(): Promise<ActionResult<LeadStatusCounts>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = await (supabase.rpc as any)('count_leads_by_status', { p_org_id: orgId }) as {
    data: Array<{ status: string; cnt: number }> | null;
    error: { message: string } | null;
  };

  if (error) {
    logQueryError(error, 'fetchLeadStatusCounts', { orgId });
    return { success: false, error: 'Erro ao buscar contagens' };
  }

  const counts: LeadStatusCounts = { all: 0, new: 0, contacted: 0, qualified: 0, won: 0, unqualified: 0, archived: 0 };
  for (const row of data ?? []) {
    counts.all += row.cnt;
    if (row.status in counts && row.status !== 'all') {
      counts[row.status as keyof Omit<LeadStatusCounts, 'all'>] = row.cnt;
    }
  }

  return { success: true, data: counts };
}

export async function fetchFilteredLeadIds(
  rawFilters: Record<string, unknown>,
): Promise<ActionResult<string[]>> {
  const parsed = leadFiltersSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return { success: false, error: 'Filtros inválidos' };
  }
  const filters: LeadFilters = parsed.data;

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Cadence filter mirrors fetchLeads: view for "Sem cadência", embedded inner
  // join for a specific cadence — never an `.in('id', [uuids])` list, que
  // estoura o limite de URL do PostgREST em cadências grandes.
  const hasSearch = !!filters.search?.trim();
  const sourceTable =
    !hasSearch && filters.cadence_id === '__none__'
      ? 'leads_no_active_enrollment'
      : 'leads';
  const filterByCadence =
    !hasSearch && !!filters.cadence_id && filters.cadence_id !== '__none__';

  let query = from(supabase, sourceTable)
    .select(filterByCadence ? 'id, cadence_enrollments!inner(cadence_id)' : 'id')
    .eq('org_id', orgId)
    .is('deleted_at', null);

  if (filterByCadence) {
    query = query
      .eq('cadence_enrollments.cadence_id', filters.cadence_id!)
      .in('cadence_enrollments.status', ['active', 'paused']);
  }

  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.enrichment_status) {
    query = query.eq('enrichment_status', filters.enrichment_status);
  }
  if (filters.porte) {
    query = query.eq('porte', filters.porte);
  }
  if (filters.cnae) {
    query = query.ilike('cnae', `${filters.cnae}%`);
  }
  if (filters.uf) {
    query = query.eq('endereco->>uf', filters.uf);
  }
  if (filters.assigned_to) {
    if (filters.assigned_to === '__unassigned__') {
      query = query.is('assigned_to', null);
    } else {
      query = query.eq('assigned_to', filters.assigned_to);
    }
  }
  if (filters.lead_source) {
    query = query.eq('lead_source', filters.lead_source);
  }
  if (filters.canal) {
    query = query.eq('canal', filters.canal);
  }
  if (filters.loss_reason_id && filters.loss_reason_id.length > 0) {
    query = query.in('loss_reason_id', filters.loss_reason_id);
  }
  const createdRange = createdAtRange(filters);
  if (createdRange?.gte) query = query.gte('created_at', createdRange.gte);
  if (createdRange?.lte) query = query.lte('created_at', createdRange.lte);
  if (filters.search) {
    const searchFields = ['razao_social', 'nome_fantasia', 'cnpj', 'first_name', 'last_name', 'email'];
    const terms = filters.search.replace(/[%_]/g, '').trim().split(/\s+/).filter(Boolean);
    if (terms.length > 0) {
      const clauses = terms.flatMap((term) => searchClausesForTerm(term, searchFields));
      query = query.or(clauses.join(','));
    }
  }

  const { data, error } = (await query) as {
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  };

  if (error) {
    logQueryError(error, 'fetchFilteredLeadIds', { orgId, filters });
    return { success: false, error: 'Erro ao buscar IDs dos leads' };
  }

  return { success: true, data: (data ?? []).map((r) => r.id) };
}

export async function fetchDistinctCnaes(): Promise<ActionResult<string[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  // DISTINCT at DB level — avoids PostgREST row limit truncating rare values.
  const { data, error } = (await supabase.rpc('get_distinct_lead_cnaes')) as {
    data: Array<{ cnae: string }> | null;
    error: { message: string } | null;
  };

  if (error) {
    logQueryError(error, 'fetchDistinctCnaes');
    return { success: false, error: 'Erro ao buscar CNAEs' };
  }

  return { success: true, data: (data ?? []).map((r) => r.cnae) };
}

export async function fetchDistinctCanais(): Promise<ActionResult<string[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Fetch configured options from standard_field_settings
  const { data: settings } = (await from(supabase, 'standard_field_settings')
    .select('options')
    .eq('org_id', orgId)
    .eq('field_key', 'canal')
    .maybeSingle()) as { data: { options: string[] | null } | null };

  // DISTINCT at DB level — avoids PostgREST row limit truncating rare values
  // (e.g. "Recovery") on orgs with many leads.
  const { data, error } = (await supabase.rpc('get_distinct_lead_canais')) as {
    data: Array<{ canal: string }> | null;
    error: { message: string } | null;
  };

  if (error) {
    logQueryError(error, 'fetchDistinctCanais', { orgId });
    return { success: false, error: 'Erro ao buscar sub-origens' };
  }

  // Merge configured options + existing values, deduplicate and sort
  const fromLeads = (data ?? []).map((r) => r.canal);
  const fromSettings = settings?.options ?? [];
  const unique = [...new Set([...fromSettings, ...fromLeads])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return { success: true, data: unique };
}

export interface LossReasonFilterOption {
  id: string;
  name: string;
  count: number;
}

// Motivos de perda da org + quantos leads têm cada motivo (para o filtro
// "Motivo de Perda"). O count vem do RPC count_leads_by_loss_reason e reflete
// exatamente o que o filtro retorna (leads com loss_reason_id, não deletados).
// Motivos sem nenhum lead ainda aparecem com count 0.
export async function fetchLossReasonsForFilter(): Promise<ActionResult<LossReasonFilterOption[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const [reasonsRes, countsRes] = await Promise.all([
    from(supabase, 'loss_reasons')
      .select('id, name, sort_order')
      .eq('org_id', orgId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    (supabase.rpc as any)('count_leads_by_loss_reason', { p_org_id: orgId }),
  ]);

  const { data: reasons, error } = reasonsRes as {
    data: Array<{ id: string; name: string; sort_order: number }> | null;
    error: { message: string } | null;
  };
  if (error) {
    logQueryError(error, 'fetchLossReasonsForFilter', { orgId });
    return { success: false, error: 'Erro ao buscar motivos de perda' };
  }

  const { data: counts } = countsRes as {
    data: Array<{ loss_reason_id: string; cnt: number }> | null;
  };
  const countMap = new Map((counts ?? []).map((c) => [c.loss_reason_id, Number(c.cnt)]));

  return {
    success: true,
    data: (reasons ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      count: countMap.get(r.id) ?? 0,
    })),
  };
}
