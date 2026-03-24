'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export async function exportLeadsCsv(
  leadIds: string[],
): Promise<ActionResult<{ csv: string; filename: string }>> {
  if (leadIds.length === 0) {
    return { success: false, error: 'Nenhum lead selecionado' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'leads')
    .select('cnpj, razao_social, nome_fantasia, porte, cnae, email, telefone, status, enrichment_status, endereco, created_at')
    .eq('org_id', orgId)
    .in('id', leadIds)) as {
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  };

  if (error || !data) {
    return { success: false, error: 'Erro ao exportar leads' };
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
