'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgId } from '@/lib/auth/get-org-id';

import { CnpjWsProvider, LemitProvider } from '../services/enrichment-provider';
import { enrichLead, enrichLeadFull } from '../services/enrichment.service';
import { LemitCpfProvider } from '../services/lemit-cpf-provider';

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
