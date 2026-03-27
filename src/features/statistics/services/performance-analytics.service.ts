import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import type {
  DailySdrPerformanceEntry,
  PerformanceAnalyticsData,
  SdrActivityComparisonEntry,
  SdrPerformanceRow,
} from '../types/performance-analytics.types';
import { safeRate } from '../types/shared';
import { buildMemberNameMap } from './member-lookup';

interface InteractionRow {
  type: string;
  lead_id: string;
  performed_by: string | null;
  cadence_id: string | null;
  created_at: string;
}

interface LeadRow {
  id: string;
  status: string;
  created_by: string | null;
  assigned_to: string | null;
}

export async function fetchPerformanceAnalyticsData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
  cadenceId?: string,
): Promise<PerformanceAnalyticsData> {
  // Fetch member name map (via admin client — org_members has no email column)
  const nameMap = await buildMemberNameMap(supabase, orgId);

  // Get member user_ids
  const { data: rawMemberIds } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('status', 'active')) as { data: { user_id: string }[] | null };
  const memberIds = rawMemberIds ?? [];

  if (memberIds.length === 0) {
    return emptyData();
  }

  const filteredIds = userIds && userIds.length > 0
    ? userIds
    : memberIds.map((m) => m.user_id);

  // Fetch interactions
  let intQuery = from(supabase, 'interactions')
    .select('type, lead_id, performed_by, cadence_id, created_at')
    .eq('org_id', orgId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd)
    .in('performed_by', filteredIds);

  if (cadenceId) {
    intQuery = intQuery.eq('cadence_id', cadenceId);
  }

  const { data: rawInteractions } = (await intQuery) as { data: InteractionRow[] | null };
  const interactions = rawInteractions ?? [];

  // Fetch leads assigned to filtered SDRs in period
  const leadsQuery = from(supabase, 'leads')
    .select('id, status, created_by, assigned_to')
    .eq('org_id', orgId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd)
    .in('assigned_to', filteredIds);

  const { data: rawLeads } = (await leadsQuery) as { data: LeadRow[] | null };
  const leads = rawLeads ?? [];

  // memberLookup: user_id → email/name for display
  const memberLookup = new Map(
    memberIds.map((m) => [m.user_id, nameMap.get(m.user_id) ?? m.user_id.slice(0, 8)]),
  );

  const totalActivities = interactions.length;
  const totalLeadsCreated = leads.length;
  const totalQualified = leads.filter((l) => l.status === 'qualified').length;

  const sdrTable = buildSdrTable(filteredIds, memberLookup, interactions, leads);
  const sdrComparison = buildSdrComparison(sdrTable);
  const { dailySdrTrend, dailySdrKeys } = buildDailySdrTrend(interactions, memberLookup);

  return {
    totalActivities,
    totalLeadsCreated,
    totalQualified,
    qualificationRate: safeRate(totalQualified, totalLeadsCreated),
    sdrTable,
    sdrComparison,
    dailySdrTrend,
    dailySdrKeys,
  };
}

function buildSdrTable(
  memberIds: string[],
  memberLookup: Map<string, string>,
  interactions: InteractionRow[],
  leads: LeadRow[],
): SdrPerformanceRow[] {
  return memberIds
    .map((userId) => {
      const userEmail = memberLookup.get(userId) ?? userId.slice(0, 8);
      const userInteractions = interactions.filter((i) => i.performed_by === userId);
      const userLeads = leads.filter((l) => l.assigned_to === userId);
      const qualified = userLeads.filter((l) => l.status === 'qualified').length;
      const meetings = userInteractions.filter((i) => i.type === 'meeting_scheduled').length;

      return {
        userId,
        userEmail,
        activities: userInteractions.length,
        leadsCreated: userLeads.length,
        qualified,
        qualificationRate: safeRate(qualified, userLeads.length),
        meetings,
      };
    })
    .filter((s) => s.activities > 0 || s.leadsCreated > 0)
    .sort((a, b) => b.activities - a.activities);
}

function buildSdrComparison(sdrTable: SdrPerformanceRow[]): SdrActivityComparisonEntry[] {
  return sdrTable.map((s) => ({
    userEmail: s.userEmail,
    activities: s.activities,
  }));
}

function buildDailySdrTrend(
  interactions: InteractionRow[],
  memberLookup: Map<string, string>,
): { dailySdrTrend: DailySdrPerformanceEntry[]; dailySdrKeys: string[] } {
  // Count activities per SDR per day
  const sdrDayMap = new Map<string, Map<string, number>>();
  const sdrTotals = new Map<string, number>();

  for (const interaction of interactions) {
    if (!interaction.performed_by) continue;
    const displayName = memberLookup.get(interaction.performed_by);
    if (!displayName) continue;

    const dateStr = interaction.created_at.slice(0, 10);

    sdrTotals.set(displayName, (sdrTotals.get(displayName) ?? 0) + 1);

    if (!sdrDayMap.has(dateStr)) {
      sdrDayMap.set(dateStr, new Map());
    }
    const dayMap = sdrDayMap.get(dateStr)!;
    dayMap.set(displayName, (dayMap.get(displayName) ?? 0) + 1);
  }

  // Get top 5 SDRs by total activity
  const topSdrs = Array.from(sdrTotals.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name]) => name);

  const dailySdrTrend: DailySdrPerformanceEntry[] = Array.from(sdrDayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayMap]) => {
      const [, month, day] = date.split('-');
      const entry: DailySdrPerformanceEntry = {
        date,
        label: `${day}/${month}`,
      };
      for (const sdr of topSdrs) {
        entry[sdr] = dayMap.get(sdr) ?? 0;
      }
      return entry;
    });

  return { dailySdrTrend, dailySdrKeys: topSdrs };
}

function emptyData(): PerformanceAnalyticsData {
  return {
    totalActivities: 0,
    totalLeadsCreated: 0,
    totalQualified: 0,
    qualificationRate: 0,
    sdrTable: [],
    sdrComparison: [],
    dailySdrTrend: [],
    dailySdrKeys: [],
  };
}
