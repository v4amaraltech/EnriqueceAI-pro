import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchLeads } from '@/features/leads/actions/fetch-leads';

import { leadTemperature, leadTier, WARM_WINDOW_DAYS, type LeadStageKey, type LeadTemperature } from '../utils/lead-insights';

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

/**
 * Carteira de UM SDR para a aba "Meus Leads". `userId` já vem validado por
 * `resolveCockpitViewer` (SDR = ele mesmo; gestor = SDR da org).
 */
export async function fetchCockpitLeads(input: {
  orgId: string;
  userId: string;
  page: number;
  perPage: number;
  search: string;
}): Promise<{ success: true; data: CockpitLeadsData } | { success: false; error: string }> {
  const { orgId, userId, page, perPage, search } = input;
  const supabase = await createServerSupabaseClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;

  const [leadsResult, countsResult, tierFieldResult] = await Promise.all([
    fetchLeads({ assigned_to: userId, search: search || undefined, page, per_page: perPage, sort_by: 'updated_at', sort_dir: 'desc' }),
    rpc('count_cockpit_lead_stages', { p_user_id: userId }),
    from(supabase, 'custom_fields').select('id').eq('org_id', orgId).eq('system_key', 'tier_output').maybeSingle() as unknown as Promise<{
      data: { id: string } | null;
    }>,
  ]);

  if (!leadsResult.success) return leadsResult;
  const leads = leadsResult.data.data;
  const ids = leads.map((l) => l.id);
  const tierFieldId = tierFieldResult.data?.id ?? null;

  if (countsResult.error) console.error('[cockpit] count_cockpit_lead_stages:', countsResult.error.message);
  const stageCounts = countsResult.error
    ? null
    : Object.fromEntries(((countsResult.data ?? []) as Array<{ stage: LeadStageKey; total: number }>).map((r) => [r.stage, Number(r.total)]));

  const now = new Date();
  const since = new Date(now.getTime() - WARM_WINDOW_DAYS * 86_400_000).toISOString();

  const [stagesResult, interactionsResult] = ids.length
    ? await Promise.all([
        rpc('cockpit_lead_stages', { p_user_id: userId, p_lead_ids: ids }),
        from(supabase, 'interactions')
          .select('lead_id, type, created_at')
          .in('lead_id', ids)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(2000) as unknown as Promise<{
          data: Array<{ lead_id: string; type: string; created_at: string }> | null;
        }>,
      ])
    : [{ data: [], error: null }, { data: [] }];

  if (stagesResult.error) console.error('[cockpit] cockpit_lead_stages:', stagesResult.error.message);
  const stageById = new Map(
    ((stagesResult.data ?? []) as Array<{ lead_id: string; stage: LeadStageKey }>).map((r) => [r.lead_id, r.stage]),
  );

  // Interações vêm da mais nova para a mais antiga: a 1ª de cada lead é a última.
  const lastInteraction = new Map<string, string>();
  const lastReply = new Map<string, string>();
  for (const i of interactionsResult.data ?? []) {
    if (!lastInteraction.has(i.lead_id)) lastInteraction.set(i.lead_id, i.created_at);
    if (i.type === 'replied' && !lastReply.has(i.lead_id)) lastReply.set(i.lead_id, i.created_at);
  }

  const rows: CockpitLeadRow[] = leads.map((l) => ({
    id: l.id,
    company: l.nome_fantasia ?? l.razao_social ?? l.cnpj ?? 'Lead sem nome',
    contact: [l.first_name, l.last_name].filter(Boolean).join(' ') || null,
    stage: stageById.get(l.id) ?? null,
    isInbound: l.is_inbound,
    leadSource: l.lead_source,
    canal: l.canal,
    tier: leadTier(tierFieldId ? (l.custom_field_values?.[tierFieldId] ?? null) : null, l.faturamento_estimado),
    segmento: l.segmento ?? null,
    temperature: leadTemperature({
      now,
      lastReplyAt: lastReply.get(l.id) ?? null,
      lastInteractionAt: lastInteraction.get(l.id) ?? null,
      meetingScheduledAt: l.meeting_scheduled_at,
    }),
    updatedAt: l.updated_at,
  }));

  return {
    success: true,
    data: { rows, total: leadsResult.data.total, page, perPage, stageCounts },
  };
}
