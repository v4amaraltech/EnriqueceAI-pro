import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';
import { logLeadEvent } from '@/features/leads/actions/log-lead-event';

import { inboundLeadSchema } from '../schemas/inbound-lead.schemas';
import type { InboundLeadResult, InboundBatchResult } from '../types';

interface IngestOptions {
  orgId: string;
  supabase: SupabaseClient;
  defaultSource: 'api' | 'webhook';
  onDuplicate: 'skip' | 'update';
}

/**
 * Ingest a batch of inbound leads. Shared between REST API and webhook endpoints.
 * Uses service role client (caller is responsible for auth).
 */
export async function ingestInboundLeads(
  rawLeads: Record<string, unknown>[],
  options: IngestOptions,
): Promise<InboundBatchResult> {
  const { orgId, supabase, defaultSource, onDuplicate } = options;

  // Check lead limit
  const limitCheck = await checkLeadLimitForOrg(supabase, orgId, rawLeads.length);
  if (!limitCheck.allowed) {
    return {
      received: rawLeads.length,
      created: 0,
      duplicates: 0,
      updated: 0,
      errors: rawLeads.length,
      results: rawLeads.map((_, i) => ({
        index: i,
        status: 'error' as const,
        error: limitCheck.error,
      })),
    };
  }

  const results: InboundLeadResult[] = [];
  let created = 0;
  let duplicates = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < rawLeads.length; i++) {
    const raw = rawLeads[i]!;
    const result = await ingestSingleLead(raw, i, orgId, supabase, defaultSource, onDuplicate);
    results.push(result);

    if (result.status === 'created') created++;
    else if (result.status === 'duplicate') duplicates++;
    else if (result.status === 'updated') updated++;
    else errors++;
  }

  return {
    received: rawLeads.length,
    created,
    duplicates,
    updated,
    errors,
    results,
  };
}

async function ingestSingleLead(
  raw: Record<string, unknown>,
  index: number,
  orgId: string,
  supabase: SupabaseClient,
  defaultSource: string,
  onDuplicate: 'skip' | 'update',
): Promise<InboundLeadResult> {
  const parsed = inboundLeadSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.errors[0]?.message ?? 'Dados inválidos';
    return { index, status: 'error', error: msg };
  }

  const data = parsed.data;
  const source = data.lead_source || defaultSource;

  // Check for duplicate by email (within same org)
  if (data.email) {
    const { data: existing } = await from(supabase, 'leads')
      .select('id')
      .eq('org_id', orgId)
      .eq('email', data.email)
      .is('deleted_at', null)
      .maybeSingle() as { data: { id: string } | null };

    if (existing) {
      if (onDuplicate === 'update') {
        await updateExistingLead(supabase, existing.id, data);
        return { index, status: 'updated', lead_id: existing.id };
      }
      return { index, status: 'duplicate', existing_lead_id: existing.id };
    }
  }

  // Check for duplicate by CNPJ (within same org)
  if (data.cnpj) {
    const { data: existing } = await from(supabase, 'leads')
      .select('id')
      .eq('org_id', orgId)
      .eq('cnpj', data.cnpj)
      .is('deleted_at', null)
      .maybeSingle() as { data: { id: string } | null };

    if (existing) {
      if (onDuplicate === 'update') {
        await updateExistingLead(supabase, existing.id, data);
        return { index, status: 'updated', lead_id: existing.id };
      }
      return { index, status: 'duplicate', existing_lead_id: existing.id };
    }
  }

  // Insert new lead
  const insertData: Record<string, unknown> = {
    org_id: orgId,
    first_name: data.first_name,
    last_name: data.last_name ?? null,
    email: data.email || null,
    telefone: data.telefone ?? null,
    nome_fantasia: data.empresa ?? null,
    cnpj: data.cnpj ?? null,
    job_title: data.job_title ?? null,
    lead_source: source,
    canal: data.canal ?? null,
    is_inbound: data.is_inbound,
    assigned_to: data.assigned_to ?? null,
    linkedin: data.linkedin ?? null,
    website: data.website ?? null,
    instagram: data.instagram ?? null,
    porte: data.porte ?? null,
    razao_social: data.razao_social ?? null,
    faturamento_estimado: data.faturamento_estimado ?? null,
    notes: data.notes ?? null,
    custom_field_values: data.custom_fields ?? {},
  };

  const { data: lead, error } = await from(supabase, 'leads')
    .insert(insertData)
    .select('id')
    .single();

  if (error || !lead) {
    return { index, status: 'error', error: error?.message ?? 'Erro ao criar lead' };
  }

  const leadId = (lead as { id: string }).id;

  // Log API creation to timeline
  logLeadEvent(supabase as Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerSupabaseClient>>, {
    orgId,
    leadId,
    userId: data.assigned_to ?? 'system',
    event: 'lead_created',
    message: `Lead criado via API (${source ?? 'inbound'})`,
    metadata: { source: 'inbound_api', lead_source: source ?? null },
  });

  // Fire-and-forget: webhook dispatch + enrichment
  dispatchWebhookEvent(supabase, orgId, 'lead.created', {
    lead_id: leadId,
    email: data.email ?? null,
    first_name: data.first_name,
    last_name: data.last_name ?? null,
    source: 'inbound_api',
  }).catch((err) => console.error('[webhook] lead.created dispatch failed:', err));

  // Trigger enrichment if CNPJ present (fire-and-forget via dynamic import)
  if (data.cnpj) {
    triggerEnrichment(leadId).catch((err) => console.error('[inbound] enrichment failed:', err));
  }

  // Enroll in cadence if cadence_id provided
  if (data.cadence_id) {
    enrollInCadence(supabase, orgId, leadId, data.cadence_id, data.assigned_to ?? null).catch((err) =>
      console.error('[inbound] cadence enrollment failed:', err),
    );
  }

  return { index, status: 'created', lead_id: leadId };
}

async function updateExistingLead(
  supabase: SupabaseClient,
  leadId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (data.telefone) updates.telefone = data.telefone;
  if (data.empresa) updates.nome_fantasia = data.empresa;
  if (data.job_title) updates.job_title = data.job_title;
  if (data.linkedin) updates.linkedin = data.linkedin;
  if (data.website) updates.website = data.website;
  if (data.notes) updates.notes = data.notes;

  if (Object.keys(updates).length > 0) {
    await from(supabase, 'leads').update(updates).eq('id', leadId);
  }
}

async function checkLeadLimitForOrg(
  supabase: SupabaseClient,
  orgId: string,
  batchSize: number,
): Promise<{ allowed: boolean; error?: string }> {
  const { data: sub } = await from(supabase, 'subscriptions')
    .select('plan_id')
    .eq('org_id', orgId)
    .maybeSingle() as { data: { plan_id: string } | null };

  if (!sub) return { allowed: true };

  const { data: plan } = await from(supabase, 'plans')
    .select('max_leads')
    .eq('id', sub.plan_id)
    .single() as { data: { max_leads: number } | null };

  if (!plan) return { allowed: true };

  const { count: leadCount } = await from(supabase, 'leads')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .is('deleted_at', null) as { count: number | null };

  const currentLeads = leadCount ?? 0;

  if (currentLeads + batchSize > plan.max_leads) {
    return {
      allowed: false,
      error: `Limite de leads atingido (${currentLeads}/${plan.max_leads}). Faça upgrade para adicionar mais.`,
    };
  }

  return { allowed: true };
}

async function enrollInCadence(
  supabase: SupabaseClient,
  orgId: string,
  leadId: string,
  cadenceId: string,
  assignedTo: string | null,
): Promise<void> {
  // Validate cadence exists and is active
  const { data: cadence } = await from(supabase, 'cadences')
    .select('id, status')
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single() as { data: { id: string; status: string } | null };

  if (!cadence || cadence.status !== 'active') return;

  await from(supabase, 'cadence_enrollments')
    .insert({
      cadence_id: cadenceId,
      lead_id: leadId,
      org_id: orgId,
      current_step: 1,
      status: 'active',
      enrolled_by: assignedTo,
    } as Record<string, unknown>);
}

async function triggerEnrichment(leadId: string): Promise<void> {
  try {
    const { enrichLeadByService } = await import('./enrich-inbound.service');
    await enrichLeadByService(leadId);
  } catch {
    // Enrichment failure should not affect lead creation
  }
}
