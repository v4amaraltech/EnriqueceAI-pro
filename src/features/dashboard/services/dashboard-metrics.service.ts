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
  const start = new Date(year, mon - 1, 1);
  const end = new Date(year, mon, 1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

/** Use dateFrom/dateTo when available, fallback to month range */
function getDateRange(filters: DashboardFilters): { start: string; end: string } {
  if (filters.dateFrom && filters.dateTo) {
    return {
      start: new Date(filters.dateFrom + 'T00:00:00').toISOString(),
      end: new Date(filters.dateTo + 'T23:59:59').toISOString(),
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
  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === year && today.getMonth() + 1 === mon;
  const maxDay = isCurrentMonth ? today.getDate() : days;

  const countByDay = new Map<number, number>();
  for (const dateStr of leadDates) {
    const d = new Date(dateStr);
    const day = d.getDate();
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

  // Query qualified leads in the month (using won_at for accuracy)
  let leadsQuery = from(supabase, 'leads')
    .select('id, won_at, assigned_to, won_by')
    .eq('org_id', orgId)
    .eq('status', 'qualified')
    .is('deleted_at', null)
    .not('won_at', 'is', null)
    .gte('won_at', start)
    .lt('won_at', end);

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

  // Calculate % of target based on linear projection
  const today = new Date();
  const [yr, mo] = filters.month.split('-').map(Number) as [number, number];
  const isCurrentMonth =
    today.getFullYear() === yr && today.getMonth() + 1 === mo;
  const currentDay = isCurrentMonth ? today.getDate() : days;

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
