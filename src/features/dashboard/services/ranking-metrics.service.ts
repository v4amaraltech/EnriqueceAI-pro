import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import type {
  DashboardFilters,
  RankingCardData,
  RankingData,
  SdrRankingEntry,
} from '../types';

function getMonthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const start = new Date(year, mon - 1, 1);
  const end = new Date(year, mon, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function getDaysInMonth(month: string): number {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return new Date(year, mon, 0).getDate();
}

function computePercentOfTarget(actual: number, target: number, days: number, month: string): number {
  if (target <= 0) return 0;
  const today = new Date();
  const [yr, mo] = month.split('-').map(Number) as [number, number];
  const isCurrentMonth = today.getFullYear() === yr && today.getMonth() + 1 === mo;
  const currentDay = isCurrentMonth ? today.getDate() : days;
  const expectedByToday = (target / days) * currentDay;
  if (expectedByToday <= 0) return 0;
  return Math.round(((actual - expectedByToday) / expectedByToday) * 100);
}

function buildRankingCardData(
  entries: SdrRankingEntry[],
  total: number,
  monthTarget: number,
  month: string,
): RankingCardData {
  const days = getDaysInMonth(month);
  const sdrCount = entries.length || 1;
  return {
    total,
    monthTarget,
    percentOfTarget: computePercentOfTarget(total, monthTarget, days, month),
    averagePerSdr: Math.round((total / sdrCount) * 10) / 10,
    sdrBreakdown: entries.sort((a, b) => b.value - a.value),
  };
}

/**
 * Card 1: Leads Finalizados — enrollments completed/replied, attributed to lead's assigned_to
 */
export async function fetchLeadsFinishedRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { start, end } = getMonthRange(filters.month);

  // Query enrollments in the period with lead_id for attribution
  let query = from(supabase, 'cadence_enrollments')
    .select('lead_id, enrolled_by, status');

  query = query.gte('updated_at', start).lt('updated_at', end);

  if (filters.cadenceIds.length > 0) {
    query = query.in('cadence_id', filters.cadenceIds);
  }

  const { data: enrollments } = (await query) as {
    data: Array<{ lead_id: string; enrolled_by: string; status: string }> | null;
  };

  const rows = enrollments ?? [];
  if (rows.length === 0) {
    const monthStart = `${filters.month}-01`;
    const { data: goal } = (await from(supabase, 'goals')
      .select('opportunity_target')
      .eq('org_id', orgId)
      .eq('month', monthStart)
      .maybeSingle()) as { data: { opportunity_target: number } | null };
    return buildRankingCardData([], 0, goal?.opportunity_target ?? 0, filters.month);
  }

  // Get lead assigned_to for attribution
  const leadIds = [...new Set(rows.map((r) => r.lead_id))];
  const { data: leadData } = (await from(supabase, 'leads')
    .select('id, assigned_to')
    .in('id', leadIds)) as {
    data: Array<{ id: string; assigned_to: string | null }> | null;
  };
  const leadAssignedTo = new Map((leadData ?? []).map((l) => [l.id, l.assigned_to]));

  // Group by SDR (use lead's assigned_to, fallback to enrolled_by)
  const sdrMap = new Map<string, { finished: number; prospecting: number }>();
  for (const e of rows) {
    const sdr = leadAssignedTo.get(e.lead_id) ?? e.enrolled_by;
    if (!sdr) continue;
    if (filters.userIds.length > 0 && !filters.userIds.includes(sdr)) continue;
    const entry = sdrMap.get(sdr) ?? { finished: 0, prospecting: 0 };
    if (e.status === 'completed' || e.status === 'replied') {
      entry.finished++;
    } else if (e.status === 'active') {
      entry.prospecting++;
    }
    sdrMap.set(sdr, entry);
  }

  const entries: SdrRankingEntry[] = [];
  let totalFinished = 0;
  for (const [userId, counts] of sdrMap) {
    totalFinished += counts.finished;
    entries.push({
      userId,
      userName: '',
      value: counts.finished,
      secondaryValue: counts.prospecting,
    });
  }

  // Get org goal for opportunity_target (proxy for leads target)
  const monthStart = `${filters.month}-01`;
  const { data: goal } = (await from(supabase, 'goals')
    .select('opportunity_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()) as { data: { opportunity_target: number } | null };

  return buildRankingCardData(entries, totalFinished, goal?.opportunity_target ?? 0, filters.month);
}

/**
 * Card 2: Atividades Realizadas — interactions count by SDR (via performed_by)
 */
export async function fetchActivitiesRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { start, end } = getMonthRange(filters.month);

  // Get interactions in the period with performed_by for direct attribution
  let interactionsQuery = from(supabase, 'interactions')
    .select('lead_id, type, performed_by')
    .eq('org_id', orgId)
    .gte('created_at', start)
    .lt('created_at', end);

  if (filters.cadenceIds.length > 0) {
    interactionsQuery = interactionsQuery.in('cadence_id', filters.cadenceIds);
  }

  const { data: interactions } = (await interactionsQuery) as {
    data: Array<{ lead_id: string; type: string; performed_by: string | null }> | null;
  };

  const interactionRows = interactions ?? [];

  if (interactionRows.length === 0) {
    const monthStart = `${filters.month}-01`;
    const { data: goal } = (await from(supabase, 'goals')
      .select('activities_target')
      .eq('org_id', orgId)
      .eq('month', monthStart)
      .maybeSingle()) as { data: { activities_target: number } | null };

    return buildRankingCardData([], 0, goal?.activities_target ?? 0, filters.month);
  }

  // For interactions without performed_by, fallback to lead's assigned_to
  const leadIdsWithoutPerformer = [
    ...new Set(interactionRows.filter((i) => !i.performed_by).map((i) => i.lead_id)),
  ];
  const leadAssignedTo = new Map<string, string>();
  if (leadIdsWithoutPerformer.length > 0) {
    const { data: leadData } = (await from(supabase, 'leads')
      .select('id, assigned_to')
      .in('id', leadIdsWithoutPerformer)) as {
      data: Array<{ id: string; assigned_to: string | null }> | null;
    };
    for (const l of leadData ?? []) {
      if (l.assigned_to) leadAssignedTo.set(l.id, l.assigned_to);
    }
  }

  // Count activities per SDR (performed_by, fallback to lead's assigned_to)
  const sdrCounts = new Map<string, number>();
  for (const interaction of interactionRows) {
    const sdr = interaction.performed_by ?? leadAssignedTo.get(interaction.lead_id);
    if (!sdr) continue;
    if (filters.userIds.length > 0 && !filters.userIds.includes(sdr)) continue;
    sdrCounts.set(sdr, (sdrCounts.get(sdr) ?? 0) + 1);
  }

  const entries: SdrRankingEntry[] = [];
  let totalActivities = 0;
  for (const [userId, count] of sdrCounts) {
    totalActivities += count;
    entries.push({ userId, userName: '', value: count });
  }

  // Get goal
  const monthStart = `${filters.month}-01`;
  const { data: goal } = (await from(supabase, 'goals')
    .select('activities_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()) as { data: { activities_target: number } | null };

  return buildRankingCardData(entries, totalActivities, goal?.activities_target ?? 0, filters.month);
}

/**
 * Card 3: Taxa de Conversão — qualified / total leads per SDR
 */
export async function fetchConversionRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { start, end } = getMonthRange(filters.month);

  // Get all leads updated in the month — use won_by for qualified attribution
  let leadsQuery = from(supabase, 'leads')
    .select('id, status, assigned_to, won_by')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('updated_at', start)
    .lt('updated_at', end);

  // Note: don't filter by assigned_to here because won_by may differ from assigned_to

  const { data: leads } = (await leadsQuery) as {
    data: Array<{ id: string; status: string; assigned_to: string | null; won_by: string | null }> | null;
  };

  const leadRows = leads ?? [];

  if (leadRows.length === 0) {
    const monthStart = `${filters.month}-01`;
    const { data: goal } = (await from(supabase, 'goals')
      .select('conversion_target')
      .eq('org_id', orgId)
      .eq('month', monthStart)
      .maybeSingle()) as { data: { conversion_target: number } | null };

    return buildRankingCardData([], 0, goal?.conversion_target ?? 0, filters.month);
  }

  // If cadence filter is active, narrow down to leads enrolled in those cadences
  let filteredLeadIds: Set<string> | null = null;
  if (filters.cadenceIds.length > 0) {
    const leadIds = leadRows.map((l) => l.id);
    const { data: enrollments } = (await from(supabase, 'cadence_enrollments')
      .select('lead_id')
      .in('lead_id', leadIds)
      .in('cadence_id', filters.cadenceIds)) as {
      data: Array<{ lead_id: string }> | null;
    };
    filteredLeadIds = new Set((enrollments ?? []).map((e) => e.lead_id));
  }

  // Count qualified and total per SDR
  // For qualified leads: use won_by (who marked as won), fallback to assigned_to
  // For other leads: use assigned_to
  const sdrStats = new Map<string, { qualified: number; total: number }>();
  for (const lead of leadRows) {
    if (filteredLeadIds && !filteredLeadIds.has(lead.id)) continue;
    const isQualified = lead.status === 'qualified';
    const sdr = isQualified
      ? (lead.won_by ?? lead.assigned_to)
      : lead.assigned_to;
    if (!sdr) continue;
    // If userIds filter is active, skip leads not belonging to filtered users
    if (filters.userIds.length > 0 && !filters.userIds.includes(sdr)) continue;
    const stats = sdrStats.get(sdr) ?? { qualified: 0, total: 0 };
    stats.total++;
    if (isQualified) {
      stats.qualified++;
    }
    sdrStats.set(sdr, stats);
  }

  const entries: SdrRankingEntry[] = [];
  let totalQualified = 0;
  let totalLeads = 0;
  for (const [userId, stats] of sdrStats) {
    totalQualified += stats.qualified;
    totalLeads += stats.total;
    const rate = stats.total > 0 ? Math.round((stats.qualified / stats.total) * 100) : 0;
    entries.push({
      userId,
      userName: '',
      value: rate,
      secondaryValue: stats.total,
    });
  }

  const overallRate = totalLeads > 0 ? Math.round((totalQualified / totalLeads) * 100) : 0;

  // Get goal
  const monthStart = `${filters.month}-01`;
  const { data: goal } = (await from(supabase, 'goals')
    .select('conversion_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()) as { data: { conversion_target: number } | null };

  const target = goal?.conversion_target ?? 0;
  const sdrCount = entries.length || 1;

  return {
    total: overallRate,
    monthTarget: target,
    percentOfTarget: target > 0 ? Math.round(((overallRate - target) / target) * 100) : 0,
    averagePerSdr: Math.round((entries.reduce((sum, e) => sum + e.value, 0) / sdrCount) * 10) / 10,
    sdrBreakdown: entries.sort((a, b) => b.value - a.value),
  };
}

/**
 * Fetch all 3 ranking cards in parallel
 */
export async function fetchRankingData(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingData> {
  const [leadsFinished, activitiesDone, conversionRate] = await Promise.all([
    fetchLeadsFinishedRanking(supabase, orgId, filters),
    fetchActivitiesRanking(supabase, orgId, filters),
    fetchConversionRanking(supabase, orgId, filters),
  ]);

  return { leadsFinished, activitiesDone, conversionRate };
}
