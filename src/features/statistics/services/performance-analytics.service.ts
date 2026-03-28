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
  won_by: string | null;
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

  // Fetch leads in period (don't filter by assigned_to here — won_by may differ)
  const leadsQuery = from(supabase, 'leads')
    .select('id, status, created_by, assigned_to, won_by')
    .eq('org_id', orgId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  const { data: rawLeads } = (await leadsQuery) as { data: LeadRow[] | null };
  const leads = rawLeads ?? [];

  // memberLookup: user_id → email/name for display
  const memberLookup = new Map(
    memberIds.map((m) => [m.user_id, nameMap.get(m.user_id) ?? m.user_id.slice(0, 8)]),
  );

  const totalActivities = interactions.length;
  // Filter leads belonging to filtered SDRs (by assigned_to)
  const filteredLeads = leads.filter((l) => l.assigned_to && filteredIds.includes(l.assigned_to));
  const totalLeadsCreated = filteredLeads.length;
  // Qualified: attributed to who marked as won (won_by), fallback to assigned_to
  const totalQualified = leads.filter((l) => {
    if (l.status !== 'qualified') return false;
    const responsible = l.won_by ?? l.assigned_to;
    return responsible && filteredIds.includes(responsible);
  }).length;

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
      // Qualified: count leads where this user is won_by (or assigned_to if won_by is null)
      const qualified = leads.filter((l) => {
        if (l.status !== 'qualified') return false;
        const responsible = l.won_by ?? l.assigned_to;
        return responsible === userId;
      }).length;
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
      const dateParts = date.split('-');
      const entry: DailySdrPerformanceEntry = {
        date,
        label: dateParts[2] && dateParts[1] ? `${dateParts[2]}/${dateParts[1]}` : date,
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
