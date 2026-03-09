'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

import type { LeadListResult } from '../leads.contract';
import type { LeadFilters } from '../schemas/lead.schemas';
import { leadFiltersSchema } from '../schemas/lead.schemas';

export async function fetchLeads(
  rawFilters: Record<string, unknown>,
): Promise<ActionResult<LeadListResult>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  // Validate filters
  const parsed = leadFiltersSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return { success: false, error: 'Filtros inválidos' };
  }
  const filters: LeadFilters = parsed.data;

  // Get user's org
  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const rangeFrom = (filters.page - 1) * filters.per_page;
  const to = rangeFrom + filters.per_page - 1;

  // Build query
  let query = from(supabase, 'leads')
    .select('*', { count: 'exact' })
    .eq('org_id', member.org_id)
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
    query = query.eq('assigned_to', filters.assigned_to);
  }

  // Full-text search
  if (filters.search) {
    const term = filters.search.replace(/[%_]/g, '');
    query = query.or(
      `razao_social.ilike.%${term}%,nome_fantasia.ilike.%${term}%,cnpj.ilike.%${term}%`,
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
