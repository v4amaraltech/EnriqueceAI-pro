import type { SupabaseClient } from '@supabase/supabase-js';

import { chunkedIn } from '@/lib/supabase/chunked-in';
import { from } from '@/lib/supabase/from';

import type {
  DailyDataPoint,
  DashboardFilters,
  RankingCardData,
  RankingData,
  SdrRankingEntry,
} from '../types';

function getMonthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(year, mon, 0).getDate();
  return {
    start: `${year}-${String(mon).padStart(2, '0')}-01T03:00:00Z`,
    end: `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59-03:00`,
  };
}

function getDateRange(filters: DashboardFilters): { start: string; end: string } {
  if (filters.dateFrom && filters.dateTo) {
    return {
      start: `${filters.dateFrom}T03:00:00Z`,
      end: `${filters.dateTo}T23:59:59-03:00`,
    };
  }
  return getMonthRange(filters.month);
}

function getDaysInMonth(month: string): number {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return new Date(year, mon, 0).getDate();
}

function computePercentOfTarget(actual: number, target: number, days: number, month: string): number {
  if (target <= 0) return 0;
  const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const [yr, mo] = month.split('-').map(Number) as [number, number];
  const isCurrentMonth = nowBrt.getUTCFullYear() === yr && nowBrt.getUTCMonth() + 1 === mo;
  const currentDay = isCurrentMonth ? nowBrt.getUTCDate() : days;
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
 * Only counts users with role='sdr' — managers are excluded.
 */
export async function fetchLeadsFinishedRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { start, end } = getDateRange(filters);

  // Get list of SDRs in the org (exclude managers)
  const { data: sdrs } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'sdr')
    .in('status', ['active', 'invited'])) as { data: Array<{ user_id: string }> | null };
  const sdrIds = new Set((sdrs ?? []).map((s) => s.user_id));

  // Query enrollments in the period with lead_id for attribution
  let query = from(supabase, 'cadence_enrollments')
    .select('lead_id, enrolled_by, status')
    .eq('org_id', orgId)
    .limit(10000);

  query = query.gte('enrolled_at', start).lt('enrolled_at', end);

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

  // Get lead assigned_to for attribution. Archived leads are skipped — they
  // were discarded and shouldn't count as "finalizados" or "prospectando".
  const leadIds = [...new Set(rows.map((r) => r.lead_id))];
  const leadData = await chunkedIn<{ id: string; assigned_to: string | null }>(leadIds, (chunk) =>
    from(supabase, 'leads')
      .select('id, assigned_to')
      .in('id', chunk)
      .is('deleted_at', null)
      .neq('status', 'archived') as unknown as PromiseLike<{
      data: Array<{ id: string; assigned_to: string | null }> | null;
      error: unknown;
    }>,
  );
  const leadAssignedTo = new Map(leadData.map((l) => [l.id, l.assigned_to]));

  // Group by SDR (use lead's assigned_to, fallback to enrolled_by only if SDR)
  const sdrMap = new Map<string, { finished: number; prospecting: number }>();
  for (const e of rows) {
    const assignedTo = leadAssignedTo.get(e.lead_id);
    // Prefer assigned_to if it's an SDR; fallback to enrolled_by only if it's an SDR
    let sdr: string | null = null;
    if (assignedTo && sdrIds.has(assignedTo)) sdr = assignedTo;
    else if (e.enrolled_by && sdrIds.has(e.enrolled_by)) sdr = e.enrolled_by;
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

  // Get org goal for leads_finished_target
  const monthStart = `${filters.month}-01`;
  const { data: goal } = (await from(supabase, 'goals')
    .select('leads_finished_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()) as { data: { leads_finished_target: number } | null };

  return buildRankingCardData(entries, totalFinished, goal?.leads_finished_target ?? 0, filters.month);
}

/**
 * Card 2: Atividades Realizadas — interactions count by SDR (via performed_by)
 * Only counts users with role='sdr' — managers are excluded.
 */
export async function fetchActivitiesRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { start, end } = getDateRange(filters);

  // Get list of SDRs (exclude managers)
  const { data: sdrs } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'sdr')
    .in('status', ['active', 'invited'])) as { data: Array<{ user_id: string }> | null };
  const sdrIds = new Set((sdrs ?? []).map((s) => s.user_id));

  // Get activity counts per performer using SQL GROUP BY (efficient at any scale)
  const { data: activityCounts } = await (supabase.rpc as any)('count_activities_by_performer', {
    p_org_id: orgId,
    p_start: start,
    p_end: end,
    p_cadence_ids: filters.cadenceIds.length > 0 ? filters.cadenceIds : null,
  }) as { data: Array<{ performer_id: string; cnt: number }> | null };

  const rows = activityCounts ?? [];

  if (rows.length === 0) {
    const monthStart = `${filters.month}-01`;
    const { data: goal } = (await from(supabase, 'goals')
      .select('activities_target')
      .eq('org_id', orgId)
      .eq('month', monthStart)
      .maybeSingle()) as { data: { activities_target: number } | null };

    return buildRankingCardData([], 0, goal?.activities_target ?? 0, filters.month);
  }

  const entries: SdrRankingEntry[] = [];
  let totalActivities = 0;
  for (const row of rows) {
    if (!sdrIds.has(row.performer_id)) continue; // Exclude managers
    if (filters.userIds.length > 0 && !filters.userIds.includes(row.performer_id)) continue;
    totalActivities += row.cnt;
    entries.push({ userId: row.performer_id, userName: '', value: row.cnt });
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
 * Only counts users with role='sdr' — managers are excluded.
 */
export async function fetchConversionRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { start, end } = getDateRange(filters);

  // Get list of SDRs (exclude managers)
  const { data: sdrs } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'sdr')
    .in('status', ['active', 'invited'])) as { data: Array<{ user_id: string }> | null };
  const sdrIds = new Set((sdrs ?? []).map((s) => s.user_id));

  // Denominator: leads that were "worked" in the period (had a cadence enrollment in the period).
  // Uses SQL function to avoid PostgREST .in() URL length limit.
  const { data: workedRows } = await (supabase.rpc as any)('fetch_conversion_ranking_data', {
    p_org_id: orgId,
    p_start: start,
    p_end: end,
  }) as {
    data: Array<{
      lead_id: string;
      status: string;
      assigned_to: string | null;
      won_by: string | null;
      won_in_period: boolean;
    }> | null;
  };

  const leadRows = (workedRows ?? []).map((r) => ({
    id: r.lead_id,
    status: r.status,
    assigned_to: r.assigned_to,
    won_by: r.won_by,
  }));
  const wonRows = (workedRows ?? [])
    .filter((r) => r.won_in_period)
    .map((r) => ({ id: r.lead_id, assigned_to: r.assigned_to, won_by: r.won_by }));

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
    const enrollments = await chunkedIn<{ lead_id: string }>(leadIds, (chunk) =>
      from(supabase, 'cadence_enrollments')
        .select('lead_id')
        .in('lead_id', chunk)
        .in('cadence_id', filters.cadenceIds) as unknown as PromiseLike<{
        data: Array<{ lead_id: string }> | null;
        error: unknown;
      }>,
    );
    filteredLeadIds = new Set(enrollments.map((e) => e.lead_id));
  }

  // Build set of won lead IDs in the period for quick lookup
  const wonLeadIds = new Set(wonRows.map((l) => l.id));
  // Map won leads to their SDR (won_by, fallback assigned_to)
  const wonLeadSdr = new Map<string, string>();
  for (const l of wonRows) {
    const sdr = l.won_by ?? l.assigned_to;
    if (sdr) wonLeadSdr.set(l.id, sdr);
  }

  // Count total leads per SDR and won leads per SDR
  const sdrStats = new Map<string, { qualified: number; total: number }>();
  for (const lead of leadRows) {
    if (filteredLeadIds && !filteredLeadIds.has(lead.id)) continue;
    const sdr = lead.assigned_to;
    if (!sdr) continue;
    if (!sdrIds.has(sdr)) continue; // Exclude managers
    if (filters.userIds.length > 0 && !filters.userIds.includes(sdr)) continue;
    const stats = sdrStats.get(sdr) ?? { qualified: 0, total: 0 };
    stats.total++;
    // Count as qualified only if won in the period
    if (wonLeadIds.has(lead.id)) {
      const wonSdr = wonLeadSdr.get(lead.id) ?? sdr;
      if (wonSdr !== sdr && sdrIds.has(wonSdr)) {
        // Won by different SDR — attribute to the one who won it
        const wonStats = sdrStats.get(wonSdr) ?? { qualified: 0, total: 0 };
        wonStats.qualified++;
        sdrStats.set(wonSdr, wonStats);
      } else if (wonSdr === sdr) {
        stats.qualified++;
      }
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
 * Card 4: Leads Abertos — first human-channel touch per lead, attributed to
 * the SDR who did it. Includes a daily cumulative breakdown for the chart.
 */
export async function fetchLeadsOpenedRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { start, end } = getDateRange(filters);
  const days = getDaysInMonth(filters.month);

  // Get list of SDRs (exclude managers)
  const { data: sdrs } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'sdr')
    .in('status', ['active', 'invited'])) as { data: Array<{ user_id: string }> | null };
  const sdrIds = new Set((sdrs ?? []).map((s) => s.user_id));

  // RPC returns one row per SDR with count of leads whose FIRST human-channel
  // interaction falls in [start, end). See migration
  // 20260522091423_goals_leads_opened_target_and_rpc.sql.
  const { data: rows } = await (supabase.rpc as any)('count_leads_opened_by_sdr', {
    p_org_id: orgId,
    p_start: start,
    p_end: end,
    p_cadence_ids: filters.cadenceIds.length > 0 ? filters.cadenceIds : null,
  }) as { data: Array<{ performer_id: string; cnt: number }> | null };

  const monthStart = `${filters.month}-01`;
  const { data: goal } = (await from(supabase, 'goals')
    .select('leads_opened_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()) as { data: { leads_opened_target: number } | null };
  const monthTarget = goal?.leads_opened_target ?? 0;

  const entries: SdrRankingEntry[] = [];
  let totalOpened = 0;
  for (const row of rows ?? []) {
    if (!sdrIds.has(row.performer_id)) continue;
    if (filters.userIds.length > 0 && !filters.userIds.includes(row.performer_id)) continue;
    totalOpened += row.cnt;
    entries.push({ userId: row.performer_id, userName: '', value: row.cnt });
  }

  // Daily cumulative chart: pull the same first-touch rows but bucket by day.
  // Reuses the RPC's filter contract via a direct SQL select on the same
  // interactions slice. We do it client-side because the RPC already aggregates.
  const dailyData = await fetchLeadsOpenedDaily(supabase, orgId, filters, sdrIds, monthTarget);

  const card = buildRankingCardData(entries, totalOpened, monthTarget, filters.month);
  return { ...card, dailyData };

  void days; // unused — buildRankingCardData computes its own days inside
}

/**
 * Per-day cumulative count of leads opened (first human touch). Mirrors the
 * RPC's window filter so the chart matches the ranking total exactly.
 */
async function fetchLeadsOpenedDaily(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
  sdrIds: Set<string>,
  target: number,
): Promise<DailyDataPoint[]> {
  const { start, end } = getDateRange(filters);
  const days = getDaysInMonth(filters.month);
  const [year, mon] = filters.month.split('-').map(Number) as [number, number];
  const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const isCurrentMonth = nowBrt.getUTCFullYear() === year && nowBrt.getUTCMonth() + 1 === mon;
  const maxDay = isCurrentMonth ? nowBrt.getUTCDate() : days;

  // chunked here would only kick in for huge cadenceIds; for the daily series
  // we just pull leads opened in the window and bucket in memory.
  const { data: rpcRows } = await (supabase.rpc as any)('count_leads_opened_by_sdr_daily', {
    p_org_id: orgId,
    p_start: start,
    p_end: end,
    p_cadence_ids: filters.cadenceIds.length > 0 ? filters.cadenceIds : null,
  }) as { data: Array<{ performer_id: string; opened_at: string }> | null };

  const countByDay = new Map<number, number>();
  for (const row of rpcRows ?? []) {
    if (!sdrIds.has(row.performer_id)) continue;
    if (filters.userIds.length > 0 && !filters.userIds.includes(row.performer_id)) continue;
    const brt = new Date(new Date(row.opened_at).getTime() - 3 * 60 * 60 * 1000);
    const day = brt.getUTCDate();
    countByDay.set(day, (countByDay.get(day) ?? 0) + 1);
  }

  const result: DailyDataPoint[] = [];
  let cumulative = 0;
  for (let day = 1; day <= days; day++) {
    cumulative += countByDay.get(day) ?? 0;
    result.push({
      date: `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day,
      actual: day <= maxDay ? cumulative : 0,
      target: target > 0 ? Math.round((target / days) * day) : 0,
    });
  }
  return result;
}

/**
 * Fetch all 4 ranking cards in parallel
 */
export async function fetchRankingData(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingData> {
  const [leadsFinished, activitiesDone, conversionRate, leadsOpened] = await Promise.all([
    fetchLeadsFinishedRanking(supabase, orgId, filters),
    fetchActivitiesRanking(supabase, orgId, filters),
    fetchConversionRanking(supabase, orgId, filters),
    fetchLeadsOpenedRanking(supabase, orgId, filters),
  ]);

  return { leadsFinished, activitiesDone, conversionRate, leadsOpened };
}
