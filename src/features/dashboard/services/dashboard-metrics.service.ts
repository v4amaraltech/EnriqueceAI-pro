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
  const { start, end } = getMonthRange(filters.month);
  const days = getDaysInMonth(filters.month);

  // Determine lead IDs to filter by (cadence/user filters)
  let filteredLeadIds: string[] | null = null;

  if (filters.cadenceIds.length > 0 || filters.userIds.length > 0) {
    let enrollmentQuery = supabase
      .from('cadence_enrollments')
      .select('lead_id');

    if (filters.cadenceIds.length > 0) {
      enrollmentQuery = enrollmentQuery.in('cadence_id', filters.cadenceIds);
    }
    if (filters.userIds.length > 0) {
      enrollmentQuery = enrollmentQuery.in('enrolled_by', filters.userIds);
    }

    const { data: enrollments } = (await enrollmentQuery) as {
      data: Array<{ lead_id: string }> | null;
    };

    filteredLeadIds = [
      ...new Set(enrollments?.map((e) => e.lead_id) ?? []),
    ];

    if (filteredLeadIds.length === 0) {
      return {
        totalOpportunities: 0,
        monthTarget: 0,
        conversionTarget: 0,
        percentOfTarget: 0,
        currentDay: new Date().getDate(),
        daysInMonth: days,
        dailyData: computeDailyData([], filters.month, 0),
      };
    }
  }

  // Query qualified leads in the month
  let leadsQuery = from(supabase, 'leads')
    .select('id, updated_at')
    .eq('org_id', orgId)
    .eq('status', 'qualified')
    .is('deleted_at', null)
    .gte('updated_at', start)
    .lt('updated_at', end);

  if (filteredLeadIds) {
    leadsQuery = leadsQuery.in('id', filteredLeadIds);
  }

  const { data: leads } = (await leadsQuery) as {
    data: Array<{ id: string; updated_at: string }> | null;
  };

  const qualifiedLeads = leads ?? [];
  const totalOpportunities = qualifiedLeads.length;

  // Query goal for the month
  const monthStart = `${filters.month}-01`;
  const { data: goal } = (await supabase
    .from('goals')
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
    qualifiedLeads.map((l) => l.updated_at),
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
  const { data } = (await supabase
    .from('cadences')
    .select('id, name')
    .eq('org_id', orgId)
    .in('status', ['active', 'paused'])
    .order('name')) as {
    data: Array<{ id: string; name: string }> | null;
  };

  return data ?? [];
}
