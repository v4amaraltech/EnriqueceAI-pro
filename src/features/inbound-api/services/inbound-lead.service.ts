import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { exceedsLimit } from '@/lib/utils/plan-limits';
import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';
import { logLeadEvent } from '@/features/leads/actions/log-lead-event';
import { normalizeOriginFields } from '@/features/leads/schemas/lead.schemas';

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
  const normalized = normalizeOriginFields(data.lead_source || defaultSource, data.canal ?? null);
  const source = normalized.lead_source;
  const canal = normalized.canal;

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

  // Resolve custom fields: accept both field IDs (UUID) and field names
  const resolvedCustomFields = data.custom_fields
    ? await resolveCustomFieldKeys(supabase, orgId, data.custom_fields)
    : {};

  // Insert new lead
  const insertData: Record<string, unknown> = {
    org_id: orgId,
    first_name: data.first_name,
    last_name: data.last_name ?? null,
    email: data.email || null,
    ...(data.emails ? { emails: data.emails } : {}),
    telefone: data.telefone ?? null,
    nome_fantasia: data.empresa ?? null,
    cnpj: data.cnpj ?? null,
    job_title: data.job_title ?? null,
    lead_source: source,
    canal,
    is_inbound: data.is_inbound,
    assigned_to: data.assigned_to ?? null,
    linkedin: data.linkedin ?? null,
    website: data.website ?? null,
    instagram: data.instagram ?? null,
    porte: data.porte ?? null,
    razao_social: data.razao_social ?? null,
    faturamento_estimado: data.faturamento_estimado ?? null,
    notes: data.notes ?? null,
    custom_field_values: resolvedCustomFields,
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

  // Notify assigned SDR about new inbound lead
  if (data.assigned_to) {
    import('@/features/notifications/services/notification.service').then(({ createNotification }) => {
      const leadName = data.empresa || [data.first_name, data.last_name].filter(Boolean).join(' ') || 'Lead';
      createNotification({
        org_id: orgId,
        user_id: data.assigned_to!,
        type: 'lead_inbound',
        title: `Novo lead inbound: ${leadName}`,
        body: [source, canal].filter(Boolean).join(' / ') || 'Via API',
        resource_type: 'lead',
        resource_id: leadId,
        metadata: { lead_source: source ?? null, canal: canal ?? null },
      }).catch((err: unknown) => console.error('[inbound] notification failed:', err));
    });
  }

  // Enrichment via CNPJ is only triggered for CSV imports, not API/webhook

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

  if (exceedsLimit(currentLeads, batchSize, plan.max_leads)) {
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

/**
 * Resolve custom field keys: accepts both UUIDs and field names.
 * If a key is not a UUID, look up the field by name and map to its ID.
 */
async function resolveCustomFieldKeys(
  supabase: SupabaseClient,
  orgId: string,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const entries = Object.entries(fields);

  // Fetch org's custom fields to map names → IDs + get field_type for currency conversion
  const { data: orgFields } = await from(supabase, 'custom_fields')
    .select('id, field_name, field_type')
    .eq('org_id', orgId) as { data: Array<{ id: string; field_name: string; field_type: string }> | null };

  if (!orgFields?.length) return fields;

  const nameToField = new Map(
    orgFields.map((f) => [f.field_name.toLowerCase().trim(), f]),
  );
  const idToType = new Map(
    orgFields.map((f) => [f.id, f.field_type]),
  );

  const resolved: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (UUID_RE.test(key)) {
      // UUID key — convert currency values from reais to centavos if needed
      const fieldType = idToType.get(key);
      resolved[key] = fieldType === 'currency' ? convertToCentavos(value) : value;
    } else {
      const field = nameToField.get(key.toLowerCase().trim());
      if (field) {
        resolved[field.id] = field.field_type === 'currency' ? convertToCentavos(value) : value;
      }
      // Skip unknown field names silently
    }
  }

  return resolved;
}

/** Convert a value from reais (e.g. 676 or "676.00") to centavos string ("67600") */
function convertToCentavos(value: unknown): string {
  if (value == null) return '';
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  if (Number.isNaN(num)) return String(value);
  return String(Math.round(num * 100));
}

