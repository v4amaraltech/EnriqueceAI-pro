/**
 * Enrichment service — orchestrates providers with rate limiting and retry.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import type { EnrichmentData, EnrichmentProvider, EnrichmentResult } from './enrichment-provider';
import type { LemitCpfProvider } from './lemit-cpf-provider';
import type { LeadSocio } from '../types';

interface EnrichLeadOptions {
  leadId: string;
  cnpj: string;
  provider: EnrichmentProvider;
  supabase: SupabaseClient;
  maxRetries?: number;
}

/**
 * Enriches a single lead, recording the attempt and updating lead data.
 * Implements retry with exponential backoff.
 */
export async function enrichLead({
  leadId,
  cnpj,
  provider,
  supabase,
  maxRetries = 3,
}: EnrichLeadOptions): Promise<EnrichmentResult> {
  // Update status to 'enriching'
  await from(supabase, 'leads')
    .update({ enrichment_status: 'enriching' } as Record<string, unknown>)
    .eq('id', leadId);

  let lastError = '';
  let result: EnrichmentResult = { success: false, error: 'No attempts made' };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt) * 1000;
      await sleep(delay);
    }

    const startTime = Date.now();
    result = await provider.enrich(cnpj);
    const durationMs = Date.now() - startTime;

    // Record attempt
    await from(supabase, 'enrichment_attempts')
      .insert({
        lead_id: leadId,
        provider: provider.name,
        status: result.success ? 'enriched' : 'enrichment_failed',
        response_data: result.data ?? null,
        error_message: result.error ?? null,
        duration_ms: durationMs,
      } as Record<string, unknown>);

    if (result.success) {
      // Update lead with enriched data
      await updateLeadWithEnrichment(supabase, leadId, result.data!);
      return result;
    }

    lastError = result.error ?? 'Unknown error';

    // Don't retry on 404 (not found)
    if (lastError === 'CNPJ not found') {
      await from(supabase, 'leads')
        .update({
          enrichment_status: 'not_found',
        } as Record<string, unknown>)
        .eq('id', leadId);
      return result;
    }
  }

  // All retries exhausted
  await from(supabase, 'leads')
    .update({
      enrichment_status: 'enrichment_failed',
    } as Record<string, unknown>)
    .eq('id', leadId);

  return { success: false, error: lastError };
}

async function updateLeadWithEnrichment(
  supabase: SupabaseClient,
  leadId: string,
  data: EnrichmentData,
): Promise<void> {
  const update: Record<string, unknown> = {
    enrichment_status: 'enriched',
    enriched_at: new Date().toISOString(),
  };

  if (data.razao_social) update.razao_social = data.razao_social;
  if (data.nome_fantasia) update.nome_fantasia = data.nome_fantasia;
  if (data.endereco) update.endereco = data.endereco;
  if (data.porte) update.porte = data.porte;
  if (data.cnae) update.cnae = data.cnae;
  if (data.situacao_cadastral) update.situacao_cadastral = data.situacao_cadastral;
  if (data.email) update.email = data.email;
  if (data.telefone) update.telefone = data.telefone;
  if (data.socios) update.socios = data.socios;
  if (data.faturamento_estimado !== undefined) update.faturamento_estimado = data.faturamento_estimado;

  await from(supabase, 'leads')
    .update(update)
    .eq('id', leadId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Full 2-step enrichment: CNPJ (company data + partners with CPF) → CPF (contact data per partner).
 * Step 1: enrichLead() with LemitProvider → company data + socios with full CPF
 * Step 2: For each socio with CPF → LemitCpfProvider.enrich(cpf) → emails, phones, address
 */
export async function enrichLeadFull({
  leadId,
  cnpj,
  cnpjProvider,
  cpfProvider,
  supabase,
  maxRetries = 3,
}: {
  leadId: string;
  cnpj: string;
  cnpjProvider: EnrichmentProvider;
  cpfProvider: LemitCpfProvider;
  supabase: SupabaseClient;
  maxRetries?: number;
}): Promise<EnrichmentResult> {
  // Step 1: Enrich with CNPJ (company + partners)
  const cnpjResult = await enrichLead({
    leadId,
    cnpj,
    provider: cnpjProvider,
    supabase,
    maxRetries,
  });

  if (!cnpjResult.success || !cnpjResult.data?.socios) {
    return cnpjResult;
  }

  // Step 2: Enrich each partner's CPF
  await enrichSocios(supabase, leadId, cnpjResult.data.socios, cpfProvider);

  return cnpjResult;
}

/**
 * Enriches each partner (socio) that has a full CPF via the Lemit CPF endpoint.
 * Updates the lead's socios JSONB in the database with contact data.
 */
async function enrichSocios(
  supabase: SupabaseClient,
  leadId: string,
  socios: NonNullable<EnrichmentData['socios']>,
  cpfProvider: LemitCpfProvider,
): Promise<void> {
  const enrichedSocios: LeadSocio[] = [];

  for (let i = 0; i < socios.length; i++) {
    const socio = socios[i]!;
    const enrichedSocio: LeadSocio = {
      nome: socio.nome,
      qualificacao: socio.qualificacao,
      cpf_masked: socio.cpf_masked,
      cpf: socio.cpf,
      participacao: socio.participacao,
      capital_social: socio.capital_social,
    };

    if (socio.cpf) {
      // Rate limit: 1s delay between CPF calls (skip before first)
      if (i > 0) {
        await sleep(1000);
      }

      try {
        const cpfResult = await cpfProvider.enrich(socio.cpf);
        if (cpfResult.success && cpfResult.data) {
          enrichedSocio.emails = cpfResult.data.emails;
          enrichedSocio.celulares = cpfResult.data.celulares;
          enrichedSocio.endereco = cpfResult.data.endereco;
          enrichedSocio.cpf_enrichment_status = 'enriched';
        } else {
          enrichedSocio.cpf_enrichment_status = 'failed';
        }
      } catch {
        enrichedSocio.cpf_enrichment_status = 'failed';
      }
    }

    enrichedSocios.push(enrichedSocio);
  }

  // Update lead socios in database
  await from(supabase, 'leads')
    .update({ socios: enrichedSocios } as Record<string, unknown>)
    .eq('id', leadId);
}

/**
 * Enriches multiple leads in batch with rate limiting.
 * Processes one at a time with delay between requests.
 */
export async function enrichLeadsBatch({
  leadIds,
  provider,
  supabase,
  delayBetweenMs = 20000, // 20s between requests (3 req/min for CNPJ.ws)
}: {
  leadIds: string[];
  provider: EnrichmentProvider;
  supabase: SupabaseClient;
  delayBetweenMs?: number;
}): Promise<{ successCount: number; failCount: number }> {
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < leadIds.length; i++) {
    const leadId = leadIds[i]!;

    // Get lead CNPJ
    const { data: lead } = (await supabase
      .from('leads')
      .select('cnpj')
      .eq('id', leadId)
      .single()) as { data: { cnpj: string } | null };

    if (!lead) {
      failCount++;
      continue;
    }

    const result = await enrichLead({
      leadId,
      cnpj: lead.cnpj,
      provider,
      supabase,
    });

    if (result.success) {
      successCount++;
    } else {
      failCount++;
    }

    // Rate limiting delay between leads (skip after last)
    if (i < leadIds.length - 1) {
      await sleep(delayBetweenMs);
    }
  }

  return { successCount, failCount };
}
