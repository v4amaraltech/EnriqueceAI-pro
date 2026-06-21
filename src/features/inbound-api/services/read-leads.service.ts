import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import type { ReadLeadsQuery } from '../schemas/read-leads.schemas';

// Curated public projection — internal columns (created_by, won_by, closer_id,
// loss_reason_id, fit_score, engagement_score, import_id, source_id…) are
// deliberately excluded.
const SELECT_COLS = [
  'id', 'status',
  'first_name', 'last_name', 'email', 'telefone', 'job_title',
  'nome_fantasia', 'razao_social', 'cnpj', 'porte', 'segmento', 'faturamento_estimado',
  'website', 'linkedin', 'instagram',
  'lead_source', 'canal', 'is_inbound', 'assigned_to', 'custom_field_values',
  'created_at', 'updated_at',
  'contacted_at', 'qualified_at', 'meeting_scheduled_at', 'meeting_starts_at',
  'meeting_held_at', 'won_at', 'lost_at',
].join(', ');

export interface PublicLead {
  id: string;
  status: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  telefone: string | null;
  job_title: string | null;
  empresa: string | null;
  razao_social: string | null;
  cnpj: string | null;
  porte: string | null;
  segmento: string | null;
  faturamento_estimado: number | null;
  website: string | null;
  linkedin: string | null;
  instagram: string | null;
  lead_source: string | null;
  canal: string | null;
  is_inbound: boolean | null;
  assigned_to: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
  contacted_at: string | null;
  qualified_at: string | null;
  meeting_scheduled_at: string | null;
  meeting_starts_at: string | null;
  meeting_held_at: string | null;
  won_at: string | null;
  lost_at: string | null;
}

/** Map a raw leads row to the curated public DTO (nome_fantasia → empresa). */
export function toPublicLead(row: Record<string, unknown>): PublicLead {
  const get = <T>(k: string): T | null => (row[k] ?? null) as T | null;
  return {
    id: row.id as string,
    status: get('status'),
    first_name: get('first_name'),
    last_name: get('last_name'),
    email: get('email'),
    telefone: get('telefone'),
    job_title: get('job_title'),
    empresa: get('nome_fantasia'),
    razao_social: get('razao_social'),
    cnpj: get('cnpj'),
    porte: get('porte'),
    segmento: get('segmento'),
    faturamento_estimado: get('faturamento_estimado'),
    website: get('website'),
    linkedin: get('linkedin'),
    instagram: get('instagram'),
    lead_source: get('lead_source'),
    canal: get('canal'),
    is_inbound: get('is_inbound'),
    assigned_to: get('assigned_to'),
    custom_fields: (row.custom_field_values as Record<string, unknown> | null) ?? {},
    created_at: get('created_at'),
    updated_at: get('updated_at'),
    contacted_at: get('contacted_at'),
    qualified_at: get('qualified_at'),
    meeting_scheduled_at: get('meeting_scheduled_at'),
    meeting_starts_at: get('meeting_starts_at'),
    meeting_held_at: get('meeting_held_at'),
    won_at: get('won_at'),
    lost_at: get('lost_at'),
  };
}

/** Fetch a single active lead by id, scoped to the org. Returns null if not found. */
export async function getLeadById(
  supabase: SupabaseClient,
  orgId: string,
  id: string,
): Promise<PublicLead | null> {
  const { data } = await from(supabase, 'leads')
    .select(SELECT_COLS)
    .eq('org_id', orgId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle() as { data: Record<string, unknown> | null };

  return data ? toPublicLead(data) : null;
}

export interface ListLeadsResult {
  data: PublicLead[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

/** List active leads for an org, paginated (offset) and filtered. */
export async function listLeads(
  supabase: SupabaseClient,
  orgId: string,
  q: ReadLeadsQuery,
): Promise<ListLeadsResult> {
  let query = from(supabase, 'leads')
    .select(SELECT_COLS, { count: 'exact' })
    .eq('org_id', orgId)
    .is('deleted_at', null);

  if (q.status) query = query.in('status', q.status);
  if (q.updated_since) query = query.gte('updated_at', q.updated_since);
  if (q.lead_source) query = query.eq('lead_source', q.lead_source);
  if (q.canal) query = query.eq('canal', q.canal);

  const fromIdx = (q.page - 1) * q.per_page;
  const toIdx = fromIdx + q.per_page - 1;

  const { data, count } = await query
    .order('created_at', { ascending: false })
    .range(fromIdx, toIdx) as { data: Record<string, unknown>[] | null; count: number | null };

  const total = count ?? 0;
  return {
    data: (data ?? []).map(toPublicLead),
    page: q.page,
    per_page: q.per_page,
    total,
    total_pages: Math.ceil(total / q.per_page),
  };
}
