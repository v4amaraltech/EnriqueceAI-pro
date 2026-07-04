'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

import type { EnrichmentStatus } from '../types';

/** n8n automation webhook — enriches the lead with Receita Federal + Google Maps
 *  + Meta/Google Ads + Apollo + phone reveal. Async: returns fast, the flow
 *  processes for ~40-120s and writes back to the lead. The backend re-reads the
 *  lead's status/origin/soft-delete from the DB, so we only send anchor context. */
const N8N_ENRICH_WEBHOOK_URL = 'https://webhook-n8n.v4companyamaral.com/webhook/enriquece';
const TIMEOUT_MS = 30_000; // webhook acks quickly; generous ceiling for slow n8n

/**
 * Dispatch the async n8n enrichment for a lead. Reads empresa/cnpj/site from the
 * DB (never trusts the client) and enforces the same anchor gate the backend
 * uses: a lead with neither CNPJ nor site can't be enriched (would match the
 * wrong homonym company). The flow itself runs asynchronously — poll
 * getLeadEnrichmentStatus() until it reports 'enriched'.
 */
export async function triggerLeadEnrichment(leadId: string): Promise<ActionResult<{ dispatched: true }>> {
  const { orgId } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  const { data: lead } = (await from(supabase, 'leads')
    .select('id, org_id, nome_fantasia, razao_social, cnpj, website')
    .eq('id', leadId)
    .single()) as {
    data: {
      id: string;
      org_id: string;
      nome_fantasia: string | null;
      razao_social: string | null;
      cnpj: string | null;
      website: string | null;
    } | null;
  };

  if (!lead || lead.org_id !== orgId) {
    return { success: false, error: 'Lead não encontrado' };
  }

  // Anchor gate (mirrors the backend): needs CNPJ or site to avoid enriching a
  // homonym company. Fail fast with a clear message instead of calling n8n.
  const cnpj = lead.cnpj?.trim() ?? '';
  const site = lead.website?.trim() ?? '';
  if (!cnpj && !site) {
    return {
      success: false,
      error: 'Cadastre o CNPJ ou o site do lead para enriquecer.',
      code: 'NO_ANCHOR',
    };
  }

  const payload = {
    lead_id: lead.id,
    empresa: lead.nome_fantasia ?? lead.razao_social ?? '',
    cnpj,
    site,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(N8N_ENRICH_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.text();
        if (body) detail = ` — ${body.slice(0, 200)}`;
      } catch {
        /* ignore */
      }
      console.error(`[trigger-enrichment] n8n returned ${response.status}${detail}`);
      return { success: false, error: 'Não foi possível iniciar o enriquecimento. Tente novamente em instantes.' };
    }

    return { success: true, data: { dispatched: true } };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: 'O enriquecimento demorou para responder. Tente novamente.' };
    }
    return { success: false, error: 'Falha ao iniciar o enriquecimento. Verifique sua conexão e tente novamente.' };
  }
}

/**
 * Lightweight read of a lead's enrichment_status, for the client to poll after
 * dispatching triggerLeadEnrichment(). Org-scoped via RLS + explicit org check.
 */
export async function getLeadEnrichmentStatus(
  leadId: string,
): Promise<ActionResult<{ status: EnrichmentStatus }>> {
  const { orgId } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  const { data: lead } = (await from(supabase, 'leads')
    .select('org_id, enrichment_status')
    .eq('id', leadId)
    .single()) as {
    data: { org_id: string; enrichment_status: EnrichmentStatus } | null;
  };

  if (!lead || lead.org_id !== orgId) {
    return { success: false, error: 'Lead não encontrado' };
  }

  return { success: true, data: { status: lead.enrichment_status } };
}
