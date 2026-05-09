import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import type {
  CadenceOption,
  DailyDataPoint,
  DashboardFilters,
  OpportunityKpiData,
} from '../types';

function getMonthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(year, mon, 0).getDate();
  return {
    start: `${year}-${String(mon).padStart(2, '0')}-01T03:00:00Z`,
    end: `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59-03:00`,
  };
}

/** Use dateFrom/dateTo when available, fallback to month range */
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

function computeDailyData(
  leadDates: string[],
  month: string,
  target: number,
): DailyDataPoint[] {
  const days = getDaysInMonth(month);
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const isCurrentMonth =
    nowBrt.getUTCFullYear() === year && nowBrt.getUTCMonth() + 1 === mon;
  const maxDay = isCurrentMonth ? nowBrt.getUTCDate() : days;

  const countByDay = new Map<number, number>();
  for (const dateStr of leadDates) {
    const brt = new Date(new Date(dateStr).getTime() - 3 * 60 * 60 * 1000);
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
      target: Math.round((target / days) * day),
    });
  }

  return result;
}

export async function fetchOpportunityKpi(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<OpportunityKpiData> {
  const { start, end } = getDateRange(filters);
  const days = getDaysInMonth(filters.month);

  // Query won leads in the month (status='won' is set by the trigger when
  // meeting_held_at is stamped, i.e. closer confirmed result=meeting_done).
  let leadsQuery = from(supabase, 'leads')
    .select('id, won_at, assigned_to, won_by')
    .eq('org_id', orgId)
    .eq('status', 'won')
    .is('deleted_at', null)
    .not('won_at', 'is', null)
    .gte('won_at', start)
    .lt('won_at', end)
    .limit(10000);

  const { data: leads } = (await leadsQuery) as {
    data: Array<{ id: string; won_at: string; assigned_to: string | null; won_by: string | null }> | null;
  };

  let qualifiedLeads = leads ?? [];

  // Filter by cadence if active
  if (filters.cadenceIds.length > 0) {
    const leadIds = qualifiedLeads.map((l) => l.id);
    if (leadIds.length > 0) {
      const { data: enrollments } = (await from(supabase, 'cadence_enrollments')
        .select('lead_id')
        .in('lead_id', leadIds)
        .in('cadence_id', filters.cadenceIds)) as {
        data: Array<{ lead_id: string }> | null;
      };
      const enrolledIds = new Set((enrollments ?? []).map((e) => e.lead_id));
      qualifiedLeads = qualifiedLeads.filter((l) => enrolledIds.has(l.id));
    }
  }

  // Filter by user: attribute via won_by (who marked as won), fallback to assigned_to
  if (filters.userIds.length > 0) {
    qualifiedLeads = qualifiedLeads.filter((l) => {
      const sdr = l.won_by ?? l.assigned_to;
      return sdr && filters.userIds.includes(sdr);
    });
  }
  const totalOpportunities = qualifiedLeads.length;

  // Query goal for the month
  const monthStart = `${filters.month}-01`;
  const { data: goal } = (await from(supabase, 'goals')
    .select('opportunity_target, conversion_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()) as {
    data: { opportunity_target: number; conversion_target: number } | null;
  };

  const monthTarget = goal?.opportunity_target ?? 0;
  const conversionTarget = goal?.conversion_target ?? 0;

  // Calculate % of target based on linear projection (BRT)
  const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const [yr, mo] = filters.month.split('-').map(Number) as [number, number];
  const isCurrentMonth =
    nowBrt.getUTCFullYear() === yr && nowBrt.getUTCMonth() + 1 === mo;
  const currentDay = isCurrentMonth ? nowBrt.getUTCDate() : days;

  const expectedByToday =
    monthTarget > 0 ? (monthTarget / days) * currentDay : 0;
  const percentOfTarget =
    expectedByToday > 0
      ? Math.round(
          ((totalOpportunities - expectedByToday) / expectedByToday) * 100,
        )
      : 0;

  const dailyData = computeDailyData(
    qualifiedLeads.map((l) => l.won_at),
    filters.month,
    monthTarget,
  );

  return {
    totalOpportunities,
    monthTarget,
    conversionTarget,
    percentOfTarget,
    currentDay,
    daysInMonth: days,
    dailyData,
  };
}

export async function fetchAvailableCadences(
  supabase: SupabaseClient,
  orgId: string,
): Promise<CadenceOption[]> {
  const { data } = (await from(supabase, 'cadences')
    .select('id, name')
    .eq('org_id', orgId)
    .in('status', ['active', 'paused'])
    .order('name')) as {
    data: Array<{ id: string; name: string }> | null;
  };

  return data ?? [];
}
