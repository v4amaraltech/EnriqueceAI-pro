'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { CnpjWsProvider, LemitProvider } from '../services/enrichment-provider';
import { enrichLead, enrichLeadFull } from '../services/enrichment.service';
import { LemitCpfProvider } from '../services/lemit-cpf-provider';

export async function bulkEnrichLeads(
  leadIds: string[],
): Promise<ActionResult<{ successCount: number; failCount: number }>> {
  if (leadIds.length === 0) {
    return { success: false, error: 'Nenhum lead selecionado' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const lemitApiUrl = process.env.LEMIT_API_URL;
  const lemitApiToken = process.env.LEMIT_API_TOKEN;
  const useLemit = !!(lemitApiUrl && lemitApiToken);

  const cnpjWsProvider = useLemit ? null : new CnpjWsProvider();
  const lemitCnpjProvider = useLemit ? new LemitProvider(lemitApiUrl, lemitApiToken) : null;
  const lemitCpfProvider = useLemit ? new LemitCpfProvider(lemitApiUrl, lemitApiToken) : null;

  // Batch fetch all leads upfront (single query instead of N queries)
  const { data: allLeads } = (await supabase
    .from('leads')
    .select('id, cnpj, org_id')
    .in('id', leadIds)) as { data: { id: string; cnpj: string; org_id: string }[] | null };

  const leadMap = new Map((allLeads ?? []).map((l) => [l.id, l]));

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < leadIds.length; i++) {
    const leadId = leadIds[i]!;
    const lead = leadMap.get(leadId);

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
