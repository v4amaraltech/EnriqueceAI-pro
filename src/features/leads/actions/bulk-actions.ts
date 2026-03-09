'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { CnpjWsProvider, LemitProvider } from '../services/enrichment-provider';
import { enrichLead, enrichLeadFull } from '../services/enrichment.service';
import { LemitCpfProvider } from '../services/lemit-cpf-provider';

export async function bulkDeleteLeads(
  leadIds: string[],
): Promise<ActionResult<{ count: number }>> {
  if (leadIds.length === 0) {
    return { success: false, error: 'Nenhum lead selecionado' };
  }

  let orgId: string;
  let supabase: Awaited<ReturnType<typeof getAuthOrgId>>['supabase'];
  try {
    const auth = await getAuthOrgId();
    orgId = auth.orgId;
    supabase = auth.supabase;
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { error } = await from(supabase, 'leads')
    .update({ deleted_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('org_id', orgId)
    .in('id', leadIds);

  if (error) {
    return { success: false, error: 'Erro ao excluir leads' };
  }

  revalidatePath('/leads');

  return { success: true, data: { count: leadIds.length } };
}

export async function bulkArchiveLeads(
  leadIds: string[],
): Promise<ActionResult<{ count: number }>> {
  if (leadIds.length === 0) {
    return { success: false, error: 'Nenhum lead selecionado' };
  }

  let orgId: string;
  let supabase: Awaited<ReturnType<typeof getAuthOrgId>>['supabase'];
  try {
    const auth = await getAuthOrgId();
    orgId = auth.orgId;
    supabase = auth.supabase;
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { error } = await from(supabase, 'leads')
    .update({ status: 'archived' } as Record<string, unknown>)
    .eq('org_id', orgId)
    .in('id', leadIds);

  if (error) {
    return { success: false, error: 'Erro ao arquivar leads' };
  }

  revalidatePath('/leads');

  return { success: true, data: { count: leadIds.length } };
}

export async function bulkEnrichLeads(
  leadIds: string[],
): Promise<ActionResult<{ successCount: number; failCount: number }>> {
  if (leadIds.length === 0) {
    return { success: false, error: 'Nenhum lead selecionado' };
  }

  let orgId: string;
  let supabase: Awaited<ReturnType<typeof getAuthOrgId>>['supabase'];
  try {
    const auth = await getAuthOrgId();
    orgId = auth.orgId;
    supabase = auth.supabase;
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const lemitApiUrl = process.env.LEMIT_API_URL;
  const lemitApiToken = process.env.LEMIT_API_TOKEN;
  const useLemit = !!(lemitApiUrl && lemitApiToken);

  const cnpjWsProvider = useLemit ? null : new CnpjWsProvider();
  const lemitCnpjProvider = useLemit ? new LemitProvider(lemitApiUrl, lemitApiToken) : null;
  const lemitCpfProvider = useLemit ? new LemitCpfProvider(lemitApiUrl, lemitApiToken) : null;

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < leadIds.length; i++) {
    const leadId = leadIds[i]!;

    // Get lead CNPJ (verify ownership)
    const { data: lead } = (await supabase
      .from('leads')
      .select('cnpj, org_id')
      .eq('id', leadId)
      .single()) as { data: { cnpj: string; org_id: string } | null };

    if (!lead || lead.org_id !== orgId) {
      failCount++;
      continue;
    }

    let result;
    if (useLemit) {
      result = await enrichLeadFull({
        leadId,
        cnpj: lead.cnpj,
        cnpjProvider: lemitCnpjProvider!,
        cpfProvider: lemitCpfProvider!,
        supabase,
      });
    } else {
      result = await enrichLead({
        leadId,
        cnpj: lead.cnpj,
        provider: cnpjWsProvider!,
        supabase,
      });
    }

    if (result.success) {
      successCount++;
    } else {
      failCount++;
    }

    // Rate limiting between requests (skip after last)
    if (i < leadIds.length - 1) {
      // Lemit: 2s delay; CNPJ.ws: 20s delay (3 req/min)
      await new Promise((resolve) => setTimeout(resolve, useLemit ? 2000 : 20000));
    }
  }

  revalidatePath('/leads');

  return { success: true, data: { successCount, failCount } };
}

export async function exportLeadsCsv(
  leadIds: string[],
): Promise<ActionResult<{ csv: string; filename: string }>> {
  if (leadIds.length === 0) {
    return { success: false, error: 'Nenhum lead selecionado' };
  }

  let orgId: string;
  let supabase: Awaited<ReturnType<typeof getAuthOrgId>>['supabase'];
  try {
    const auth = await getAuthOrgId();
    orgId = auth.orgId;
    supabase = auth.supabase;
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

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
