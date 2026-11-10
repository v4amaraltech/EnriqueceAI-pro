import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchLeads } from '@/features/leads/actions/fetch-leads';

import { leadTemperature, leadTier, WARM_WINDOW_DAYS, type LeadStageKey, type LeadTemperature } from '../utils/lead-insights';
import {
  applyPortfolio,
  isLeadStage,
  portfolioNeedsScan,
  portfolioRange,
  type PortfolioFilters,
  type StageDates,
} from '../utils/portfolio-period';

export interface CockpitLeadRow {
  id: string;
  company: string;
  contact: string | null;
  stage: LeadStageKey | null;
  isInbound: boolean;
  leadSource: string | null;
  canal: string | null;
  tier: string | null;
  segmento: string | null;
  temperature: LeadTemperature;
  updatedAt: string;
}

export interface CockpitLeadsData {
  rows: CockpitLeadRow[];
  total: number;
  page: number;
  perPage: number;
  /** Contagem por etapa; `null` se a RPC falhou (cards somem, a tabela segue). */
  stageCounts: Partial<Record<LeadStageKey, number>> | null;
}

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

interface LoadedLead {
  id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  telefone: string | null;
  phone_digits: string | null;
  is_inbound: boolean;
  lead_source: string | null;
  canal: string | null;
  segmento: string | null;
  faturamento_estimado: number | null;
  custom_field_values: Record<string, string> | null;
  created_at: string;
  updated_at: string;
  contacted_at: string | null;
  qualified_at: string | null;
  meeting_scheduled_at: string | null;
  meeting_no_show_at: string | null;
  meeting_held_at: string | null;
  lost_at: string | null;
  won_at: string | null;
}

const LEAD_COLUMNS = 'id, nome_fantasia, razao_social, cnpj, first_name, last_name, email, telefone, phone_digits, is_inbound, lead_source, canal, segmento, faturamento_estimado, custom_field_values, created_at, updated_at, contacted_at, qualified_at, meeting_scheduled_at, meeting_no_show_at, meeting_held_at, lost_at, won_at';

/**
 * Carteira de UM SDR para a aba "Meus Leads". `userId` já vem validado por
 * `resolveCockpitViewer` (SDR = ele mesmo; gestor = SDR da org).
 * Sem período e sem etapa, a lista segue `fetchLeads` (comportamento atual).
 * Com filtro, cartões e tabela usam a mesma data de entrada na etapa.
 */
export async function fetchCockpitLeads(input: {
  orgId: string;
  userId: string;
  page: number;
  perPage: number;
  search: string;
  filters?: PortfolioFilters;
  now?: Date;
}): Promise<{ success: true; data: CockpitLeadsData } | { success: false; error: string }> {
  const filters = input.filters ?? { period: null, from: null, to: null, stage: null };
  const range = portfolioRange(filters, input.now);
  const supabase = await createServerSupabaseClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;

  if (!portfolioNeedsScan(filters, range)) {
    return fetchUnfiltered({ ...input, supabase, rpc });
  }
  return fetchFiltered({ ...input, filters, range, supabase, rpc });
}

async function fetchUnfiltered(input: {
  orgId: string;
  userId: string;
  page: number;
  perPage: number;
  search: string;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  rpc: Rpc;
}): Promise<{ success: true; data: CockpitLeadsData } | { success: false; error: string }> {
  const { orgId, userId, page, perPage, search, supabase, rpc } = input;
  const [leadsResult, countsResult, tierFieldResult] = await Promise.all([
    fetchLeads({ assigned_to: userId, search: search || undefined, page, per_page: perPage, sort_by: 'updated_at', sort_dir: 'desc' }),
    rpc('count_cockpit_lead_stages', { p_user_id: userId }),
    tierFieldId(supabase, orgId),
  ]);

  if (!leadsResult.success) return leadsResult;
  const leads = leadsResult.data.data;
  const ids = leads.map((l) => l.id);

  if (countsResult.error) console.error('[cockpit] count_cockpit_lead_stages:', countsResult.error.message);
  const stageCounts = countsResult.error
    ? null
    : Object.fromEntries(((countsResult.data ?? []) as Array<{ stage: LeadStageKey; total: number }>).map((r) => [r.stage, Number(r.total)]));

  const stagesResult = ids.length
    ? await rpc('cockpit_lead_stages', { p_user_id: userId, p_lead_ids: ids })
    : { data: [], error: null };
  if (stagesResult.error) console.error('[cockpit] cockpit_lead_stages:', stagesResult.error.message);
  const stageById = new Map(
    ((stagesResult.data ?? []) as Array<{ lead_id: string; stage: string }>).flatMap((r) => (
      isLeadStage(r.stage) ? [[r.lead_id, r.stage] as const] : []
    )),
  );

  const rows = await withTemperature(supabase, leads.map((l) => ({
    id: l.id,
    company: l.nome_fantasia ?? l.razao_social ?? l.cnpj ?? 'Lead sem nome',
    contact: [l.first_name, l.last_name].filter(Boolean).join(' ') || null,
    stage: stageById.get(l.id) ?? null,
    isInbound: l.is_inbound,
    leadSource: l.lead_source,
    canal: l.canal,
    tier: leadTier(tierFieldResult ? (l.custom_field_values?.[tierFieldResult] ?? null) : null, l.faturamento_estimado),
    segmento: l.segmento ?? null,
    temperature: 'frio' as const,
    updatedAt: l.updated_at,
    meetingScheduledAt: l.meeting_scheduled_at,
  })));

  return {
    success: true,
    data: { rows, total: leadsResult.data.total, page, perPage, stageCounts },
  };
}

async function fetchFiltered(input: {
  orgId: string;
  userId: string;
  page: number;
  perPage: number;
  search: string;
  filters: PortfolioFilters;
  range: ReturnType<typeof portfolioRange>;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  rpc: Rpc;
}): Promise<{ success: true; data: CockpitLeadsData } | { success: false; error: string }> {
  const { orgId, userId, page, perPage, search, filters, range, supabase, rpc } = input;
  const [stagesResult, tierId, leads] = await Promise.all([
    rpc('cockpit_lead_stages', { p_user_id: userId }),
    tierFieldId(supabase, orgId),
    loadAssignedLeads(supabase, orgId, userId),
  ]);
  if (stagesResult.error) {
    console.error('[cockpit] cockpit_lead_stages:', stagesResult.error.message);
    return { success: false, error: 'Não foi possível filtrar a carteira.' };
  }
  if (!leads.success) return leads;

  const stageById = new Map(
    ((stagesResult.data ?? []) as Array<{ lead_id: string; stage: string }>).flatMap((r) => (
      isLeadStage(r.stage) ? [[r.lead_id, r.stage] as const] : []
    )),
  );

  const items = leads.data.flatMap((lead) => {
    const stage = stageById.get(lead.id);
    if (!stage) return [];
    return [{
      ...lead,
      id: lead.id,
      stage,
      dates: stageDates(lead),
      updatedAt: lead.updated_at,
      haystack: [lead.nome_fantasia, lead.razao_social, lead.cnpj, lead.first_name, lead.last_name, lead.email, lead.telefone]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
      phoneDigits: lead.phone_digits || (lead.telefone ?? '').replace(/\D/g, ''),
      cnpj: lead.cnpj ?? '',
    }];
  });

  const { counts, matches } = applyPortfolio(items, { range, stage: filters.stage, search });
  const lastPage = Math.max(1, Math.ceil(matches.length / perPage));
  const safePage = Math.min(Math.max(1, page), lastPage);
  const pageItems = matches.slice((safePage - 1) * perPage, safePage * perPage);
  const rows = await withTemperature(supabase, pageItems.map((lead) => ({
    id: lead.id,
    company: lead.nome_fantasia ?? lead.razao_social ?? lead.cnpj ?? 'Lead sem nome',
    contact: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || null,
    stage: lead.stage,
    isInbound: lead.is_inbound,
    leadSource: lead.lead_source,
    canal: lead.canal,
    tier: leadTier(tierId ? (lead.custom_field_values?.[tierId] ?? null) : null, lead.faturamento_estimado),
    segmento: lead.segmento ?? null,
    temperature: 'frio' as const,
    updatedAt: lead.updated_at,
    meetingScheduledAt: lead.meeting_scheduled_at,
  })));

  return {
    success: true,
    data: { rows, total: matches.length, page: safePage, perPage, stageCounts: counts },
  };
}

function stageDates(lead: LoadedLead): StageDates {
  return {
    created_at: lead.created_at,
    updated_at: lead.updated_at,
    lost_at: lead.lost_at,
    contacted_at: lead.contacted_at,
    qualified_at: lead.qualified_at,
    meeting_scheduled_at: lead.meeting_scheduled_at,
    meeting_no_show_at: lead.meeting_no_show_at,
    meeting_held_at: lead.meeting_held_at,
    won_at: lead.won_at,
  };
}

async function loadAssignedLeads(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  orgId: string,
  userId: string,
): Promise<{ success: true; data: LoadedLead[] } | { success: false; error: string }> {
  const pageSize = 1000;
  const rows: LoadedLead[] = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = (await from(supabase, 'leads')
      .select(LEAD_COLUMNS)
      .eq('org_id', orgId)
      .eq('assigned_to', userId)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(start, start + pageSize - 1)) as {
      data: LoadedLead[] | null;
      error: { message: string } | null;
    };
    if (error) {
      console.error('[cockpit] leads da carteira:', error.message);
      return { success: false, error: 'Não foi possível filtrar a carteira.' };
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return { success: true, data: rows };
}

async function tierFieldId(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  orgId: string,
): Promise<string | null> {
  const result = (await from(supabase, 'custom_fields')
    .select('id')
    .eq('org_id', orgId)
    .eq('system_key', 'tier_output')
    .maybeSingle()) as { data: { id: string } | null };
  return result.data?.id ?? null;
}

async function withTemperature(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  rows: Array<Omit<CockpitLeadRow, 'temperature'> & { meetingScheduledAt: string | null }>,
): Promise<CockpitLeadRow[]> {
  const now = new Date();
  const since = new Date(now.getTime() - WARM_WINDOW_DAYS * 86_400_000).toISOString();
  const ids = rows.map((row) => row.id);
  const interactionsResult = ids.length
    ? (await from(supabase, 'interactions')
      .select('lead_id, type, created_at')
      .in('lead_id', ids)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(2000)) as {
      data: Array<{ lead_id: string; type: string; created_at: string }> | null;
    }
    : { data: [] };

  const lastInteraction = new Map<string, string>();
  const lastReply = new Map<string, string>();
  for (const interaction of interactionsResult.data ?? []) {
    if (!lastInteraction.has(interaction.lead_id)) lastInteraction.set(interaction.lead_id, interaction.created_at);
    if (interaction.type === 'replied' && !lastReply.has(interaction.lead_id)) lastReply.set(interaction.lead_id, interaction.created_at);
  }

  return rows.map(({ meetingScheduledAt, ...row }) => ({
    ...row,
    temperature: leadTemperature({
      now,
      lastReplyAt: lastReply.get(row.id) ?? null,
      lastInteractionAt: lastInteraction.get(row.id) ?? null,
      meetingScheduledAt,
    }),
  }));
}

