'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { LeadFilters } from '../schemas/lead.schemas';
import { leadFiltersSchema } from '../schemas/lead.schemas';

export async function exportAllFilteredLeadsCsv(
  rawFilters: Record<string, unknown>,
): Promise<ActionResult<{ csv: string; filename: string }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const parsed = leadFiltersSchema.safeParse(rawFilters);
  const filters: Partial<LeadFilters> = parsed.success ? parsed.data : {};

  let query = from(supabase, 'leads')
    .select('cnpj, razao_social, nome_fantasia, porte, cnae, email, telefone, status, enrichment_status, endereco, created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.enrichment_status) query = query.eq('enrichment_status', filters.enrichment_status);
  if (filters.porte) query = query.eq('porte', filters.porte);
  if (filters.cnae) query = query.ilike('cnae', `${filters.cnae}%`);
  if (filters.uf) query = query.eq('endereco->>uf', filters.uf);
  if (filters.lead_source) query = query.eq('lead_source', filters.lead_source);
  if (filters.assigned_to) {
    if (filters.assigned_to === '__unassigned__') {
      query = query.is('assigned_to', null);
    } else {
      query = query.eq('assigned_to', filters.assigned_to);
    }
  }
  if (filters.search) {
    const term = filters.search.replace(/[%_]/g, '');
    query = query.or(
      `razao_social.ilike.%${term}%,nome_fantasia.ilike.%${term}%,cnpj.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`,
    );
  }

  const { data, error } = (await query.order('created_at', { ascending: false }).limit(10000)) as {
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  };

  if (error || !data) {
    return { success: false, error: 'Erro ao exportar leads' };
  }

  if (data.length === 0) {
    return { success: false, error: 'Nenhum lead encontrado com os filtros aplicados' };
  }

  const headers = ['CNPJ', 'Razão Social', 'Nome Fantasia', 'Porte', 'CNAE', 'Email', 'Telefone', 'UF', 'Cidade', 'Status', 'Enriquecimento', 'Criado em'];

  const rows = data.map((lead) => {
    const endereco = lead.endereco as { uf?: string; cidade?: string } | null;
    return [
      lead.cnpj as string,
      (lead.razao_social as string) ?? '',
      (lead.nome_fantasia as string) ?? '',
      (lead.porte as string) ?? '',
      (lead.cnae as string) ?? '',
      (lead.email as string) ?? '',
      (lead.telefone as string) ?? '',
      endereco?.uf ?? '',
      endereco?.cidade ?? '',
      lead.status as string,
      lead.enrichment_status as string,
      lead.created_at as string,
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const filename = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;

  return { success: true, data: { csv, filename } };
}
