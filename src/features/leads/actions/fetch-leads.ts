'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { LeadListResult } from '../leads.contract';
import type { LeadFilters } from '../schemas/lead.schemas';
import { leadFiltersSchema } from '../schemas/lead.schemas';

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

  // Build query
  let query = from(supabase, 'leads')
    .select('*', { count: 'exact' })
    .eq('org_id', orgId)
    .is('deleted_at', null);

  // Apply filters
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

  // Filter by cadence enrollment (cadence_enrollments has no org_id — scope via cadence_id)
  if (filters.cadence_id) {
    if (filters.cadence_id === '__none__') {
      // Leads without active enrollment — get org cadence IDs first
      const { data: orgCadences } = (await from(supabase, 'cadences')
        .select('id')
        .eq('org_id', orgId)
        .is('deleted_at', null)) as { data: Array<{ id: string }> | null };
      const orgCadenceIds = (orgCadences ?? []).map((c) => c.id);
      if (orgCadenceIds.length > 0) {
        const { data: enrolled } = (await from(supabase, 'cadence_enrollments')
          .select('lead_id')
          .in('cadence_id', orgCadenceIds)
          .in('status', ['active', 'paused'])) as { data: Array<{ lead_id: string }> | null };
        const enrolledIds = [...new Set((enrolled ?? []).map((e) => e.lead_id))];
        if (enrolledIds.length > 0) {
          query = query.not('id', 'in', `(${enrolledIds.join(',')})`);
        }
      }
    } else {
      // Leads enrolled in a specific cadence
      const { data: enrolled } = (await from(supabase, 'cadence_enrollments')
        .select('lead_id')
        .eq('cadence_id', filters.cadence_id)
        .in('status', ['active', 'paused'])) as { data: Array<{ lead_id: string }> | null };
      const enrolledIds = [...new Set((enrolled ?? []).map((e) => e.lead_id))];
      if (enrolledIds.length === 0) {
        return { success: true, data: { data: [], total: 0, page: filters.page, per_page: filters.per_page } };
      }
      query = query.in('id', enrolledIds);
    }
  }

  // Full-text search
  if (filters.search) {
    const term = filters.search.replace(/[%_]/g, '');
    query = query.or(
      `razao_social.ilike.%${term}%,nome_fantasia.ilike.%${term}%,cnpj.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`,
    );
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
  unqualified: number;
  archived: number;
}

export async function fetchLeadStatusCounts(): Promise<ActionResult<LeadStatusCounts>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'leads')
    .select('status')
    .eq('org_id', orgId)
    .is('deleted_at', null)) as {
    data: Array<{ status: string }> | null;
    error: { message: string } | null;
  };

  if (error) {
    return { success: false, error: 'Erro ao buscar contagens' };
  }

  const counts: LeadStatusCounts = { all: 0, new: 0, contacted: 0, qualified: 0, unqualified: 0, archived: 0 };
  for (const row of data ?? []) {
    counts.all++;
    if (row.status in counts && row.status !== 'all') {
      counts[row.status as keyof Omit<LeadStatusCounts, 'all'>]++;
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

  let query = from(supabase, 'leads')
    .select('id')
    .eq('org_id', orgId)
    .is('deleted_at', null);

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
  if (filters.search) {
    const term = filters.search.replace(/[%_]/g, '');
    query = query.or(
      `razao_social.ilike.%${term}%,nome_fantasia.ilike.%${term}%,cnpj.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`,
    );
  }

  const { data, error } = (await query) as {
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  };

  if (error) {
    return { success: false, error: 'Erro ao buscar IDs dos leads' };
  }

  return { success: true, data: (data ?? []).map((r) => r.id) };
}

export async function fetchDistinctCnaes(): Promise<ActionResult<string[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'leads')
    .select('cnae')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .not('cnae', 'is', null)
    .not('cnae', 'eq', '')
    .order('cnae')) as {
    data: Array<{ cnae: string }> | null;
    error: { message: string } | null;
  };

  if (error) {
    return { success: false, error: 'Erro ao buscar CNAEs' };
  }

  const unique = [...new Set((data ?? []).map((r) => r.cnae))];
  return { success: true, data: unique };
}

export async function fetchDistinctCanais(): Promise<ActionResult<string[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'leads')
    .select('canal')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .not('canal', 'is', null)
    .not('canal', 'eq', '')
    .order('canal')) as {
    data: Array<{ canal: string }> | null;
    error: { message: string } | null;
  };

  if (error) {
    return { success: false, error: 'Erro ao buscar sub-origens' };
  }

  const unique = [...new Set((data ?? []).map((r) => r.canal))];
  return { success: true, data: unique };
}
