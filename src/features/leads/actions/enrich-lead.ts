'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { CnpjWsProvider, LemitProvider } from '../services/enrichment-provider';
import { enrichLead, enrichLeadFull } from '../services/enrichment.service';
import { LemitCpfProvider } from '../services/lemit-cpf-provider';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function enrichLeadAction(leadId: string): Promise<ActionResult<void>> {
  if (!UUID_RE.test(leadId)) return { success: false, error: 'ID inválido' };
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data: lead } = (await supabase
    .from('leads')
    .select('id, cnpj, org_id')
    .eq('id', leadId)
    .single()) as { data: { id: string; cnpj: string; org_id: string } | null };

  if (!lead || lead.org_id !== orgId) {
    return { success: false, error: 'Lead não encontrado' };
  }

  const lemitApiUrl = process.env.LEMIT_API_URL;
  const lemitApiToken = process.env.LEMIT_API_TOKEN;

  let result;
  if (lemitApiUrl && lemitApiToken) {
    // Lemit 2-step enrichment: CNPJ → CPF per partner
    const cnpjProvider = new LemitProvider(lemitApiUrl, lemitApiToken);
    const cpfProvider = new LemitCpfProvider(lemitApiUrl, lemitApiToken);
    result = await enrichLeadFull({
      leadId: lead.id,
      cnpj: lead.cnpj,
      cnpjProvider,
      cpfProvider,
      supabase,
    });
  } else {
    // Fallback: CNPJ.ws (free tier, basic data)
    const provider = new CnpjWsProvider();
    result = await enrichLead({
      leadId: lead.id,
      cnpj: lead.cnpj,
      provider,
      supabase,
    });
  }

  revalidatePath('/leads');
  revalidatePath(`/leads/${leadId}`);

  if (!result.success) {
    return { success: false, error: result.error ?? 'Falha no enriquecimento' };
  }

  return { success: true, data: undefined };
}
