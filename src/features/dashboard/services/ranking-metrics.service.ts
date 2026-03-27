import type { SupabaseClient } from '@supabase/supabase-js';

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
 * Card 1: Leads Finalizados — enrollments completed/replied by SDR
 */
export async function fetchLeadsFinishedRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { start, end } = getMonthRange(filters.month);

  // Query enrollments in the period, grouped by enrolled_by
  let query = supabase
    .from('cadence_enrollments')
    .select('enrolled_by, status');

  // Filter by date: use enrolled_at for active, completed_at/updated_at for finished
  // We filter enrollments updated in the month range
  query = query.gte('updated_at', start).lt('updated_at', end);

  if (filters.cadenceIds.length > 0) {
    query = query.in('cadence_id', filters.cadenceIds);
  }
  if (filters.userIds.length > 0) {
    query = query.in('enrolled_by', filters.userIds);
  }

  const { data: enrollments } = (await query) as {
    data: Array<{ enrolled_by: string; status: string }> | null;
  };

  const rows = enrollments ?? [];

  // Group by SDR
  const sdrMap = new Map<string, { finished: number; prospecting: number }>();
  for (const e of rows) {
    if (!e.enrolled_by) continue;
    const entry = sdrMap.get(e.enrolled_by) ?? { finished: 0, prospecting: 0 };
    if (e.status === 'completed' || e.status === 'replied') {
      entry.finished++;
    } else if (e.status === 'active') {
      entry.prospecting++;
    }
    sdrMap.set(e.enrolled_by, entry);
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
  const { data: goal } = (await supabase
    .from('goals')
    .select('opportunity_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()) as { data: { opportunity_target: number } | null };

  return buildRankingCardData(entries, totalFinished, goal?.opportunity_target ?? 0, filters.month);
}

/**
 * Card 2: Atividades Realizadas — interactions count by SDR
 */
export async function fetchActivitiesRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { start, end } = getMonthRange(filters.month);

  // Get interactions in the period
  let interactionsQuery = supabase
    .from('interactions')
    .select('lead_id, type')
    .eq('org_id', orgId)
    .gte('created_at', start)
    .lt('created_at', end);

  if (filters.cadenceIds.length > 0) {
    interactionsQuery = interactionsQuery.in('cadence_id', filters.cadenceIds);
  }

  const { data: interactions } = (await interactionsQuery) as {
    data: Array<{ lead_id: string; type: string }> | null;
  };

  const interactionRows = interactions ?? [];

  // Map lead_id → enrolled_by via cadence_enrollments
  const leadIds = [...new Set(interactionRows.map((i) => i.lead_id))];

  if (leadIds.length === 0) {
    const monthStart = `${filters.month}-01`;
    const { data: goal } = (await supabase
      .from('goals')
      .select('activities_target')
      .eq('org_id', orgId)
      .eq('month', monthStart)
      .maybeSingle()) as { data: { activities_target: number } | null };

    return buildRankingCardData([], 0, goal?.activities_target ?? 0, filters.month);
  }

  let enrollmentQuery = supabase
    .from('cadence_enrollments')
    .select('lead_id, enrolled_by')
    .in('lead_id', leadIds);

  if (filters.userIds.length > 0) {
    enrollmentQuery = enrollmentQuery.in('enrolled_by', filters.userIds);
  }

  const { data: enrollments } = (await enrollmentQuery) as {
    data: Array<{ lead_id: string; enrolled_by: string }> | null;
  };

  // Build lead → SDR map
  const leadToSdr = new Map<string, string>();
  for (const e of enrollments ?? []) {
    if (e.enrolled_by) {
      leadToSdr.set(e.lead_id, e.enrolled_by);
    }
  }

  // Count activities per SDR
  const sdrCounts = new Map<string, number>();
  for (const interaction of interactionRows) {
    const sdr = leadToSdr.get(interaction.lead_id);
    if (!sdr) continue;
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
  const { data: goal } = (await supabase
    .from('goals')
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

  // Get all leads updated in the month, attributed to their creator (SDR)
  let leadsQuery = supabase
    .from('leads')
    .select('id, status, created_by')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('updated_at', start)
    .lt('updated_at', end);

  if (filters.userIds.length > 0) {
    leadsQuery = leadsQuery.in('created_by', filters.userIds);
  }

  const { data: leads } = (await leadsQuery) as {
    data: Array<{ id: string; status: string; created_by: string }> | null;
  };

  const leadRows = leads ?? [];

  if (leadRows.length === 0) {
    const monthStart = `${filters.month}-01`;
    const { data: goal } = (await supabase
      .from('goals')
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
    const { data: enrollments } = (await supabase
      .from('cadence_enrollments')
      .select('lead_id')
      .in('lead_id', leadIds)
      .in('cadence_id', filters.cadenceIds)) as {
      data: Array<{ lead_id: string }> | null;
    };
    filteredLeadIds = new Set((enrollments ?? []).map((e) => e.lead_id));
  }

  // Count qualified and total per SDR (attributed via created_by)
  const sdrStats = new Map<string, { qualified: number; total: number }>();
  for (const lead of leadRows) {
    if (filteredLeadIds && !filteredLeadIds.has(lead.id)) continue;
    const sdr = lead.created_by;
    if (!sdr) continue;
    const stats = sdrStats.get(sdr) ?? { qualified: 0, total: 0 };
    stats.total++;
    if (lead.status === 'qualified') {
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
  const { data: goal } = (await supabase
    .from('goals')
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
