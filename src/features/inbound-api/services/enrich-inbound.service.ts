import { createServiceRoleClient } from '@/lib/supabase/service';
import { CnpjWsProvider, LemitProvider } from '@/features/leads/services/enrichment-provider';
import { enrichLead, enrichLeadFull } from '@/features/leads/services/enrichment.service';
import { LemitCpfProvider } from '@/features/leads/services/lemit-cpf-provider';

/**
 * Trigger enrichment for an inbound lead using service role (no auth context).
 * Mirrors the logic in enrichLeadAction but without requireAuth.
 */
export async function enrichLeadByService(leadId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: lead } = await supabase
    .from('leads')
    .select('id, cnpj')
    .eq('id', leadId)
    .single() as { data: { id: string; cnpj: string | null } | null };

  if (!lead?.cnpj) return;

  const lemitApiUrl = process.env.LEMIT_API_URL;
  const lemitApiToken = process.env.LEMIT_API_TOKEN;

  if (lemitApiUrl && lemitApiToken) {
    const cnpjProvider = new LemitProvider(lemitApiUrl, lemitApiToken);
    const cpfProvider = new LemitCpfProvider(lemitApiUrl, lemitApiToken);
    await enrichLeadFull({
      leadId: lead.id,
      cnpj: lead.cnpj,
      cnpjProvider,
      cpfProvider,
      supabase,
    });
  } else {
    const provider = new CnpjWsProvider();
    await enrichLead({
      leadId: lead.id,
      cnpj: lead.cnpj,
      provider,
      supabase,
    });
  }
}
