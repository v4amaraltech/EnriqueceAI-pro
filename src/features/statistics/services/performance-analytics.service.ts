import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import type {
  DailyControlRow,
  DailySdrPerformanceEntry,
  PerformanceAnalyticsData,
  SdrActivityComparisonEntry,
  SdrPerformanceRow,
} from '../types/performance-analytics.types';
import type { InteractionQueryRow, LeadQueryRow } from '../types/query-rows';
import { groupBy, safeRate } from '../types/shared';
import { buildMemberNameMap } from './member-lookup';

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
    .select('type, channel, lead_id, performed_by, cadence_id, created_at')
    .eq('org_id', orgId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd)
    .in('performed_by', filteredIds);

  if (cadenceId) {
    intQuery = intQuery.eq('cadence_id', cadenceId);
  }

  const { data: rawInteractions } = (await intQuery) as { data: InteractionQueryRow[] | null };
  const interactions = rawInteractions ?? [];

  // Fetch leads in period (don't filter by assigned_to here — won_by may differ)
  const leadsQuery = from(supabase, 'leads')
    .select('id, status, created_by, assigned_to, won_by')
    .eq('org_id', orgId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  const { data: rawLeads } = (await leadsQuery) as { data: LeadQueryRow[] | null };
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

  // Build lookup maps once — O(n) instead of O(n×m) per member
  const interactionsByUser = groupBy(interactions, (i) => i.performed_by ?? '');
  const leadsByAssignee = groupBy(leads, (l) => l.assigned_to ?? '');

  const sdrTable = buildSdrTable(filteredIds, memberLookup, interactionsByUser, leadsByAssignee, leads);
  const sdrComparison = buildSdrComparison(sdrTable);
  const { dailySdrTrend, dailySdrKeys } = buildDailySdrTrend(interactions, memberLookup);

  const dailyControl = buildDailyControl(filteredIds, memberLookup, interactionsByUser, leadsByAssignee);

  return {
    totalActivities,
    totalLeadsCreated,
    totalQualified,
    qualificationRate: safeRate(totalQualified, totalLeadsCreated),
    sdrTable,
    sdrComparison,
    dailySdrTrend,
    dailySdrKeys,
    dailyControl,
  };
}

function buildSdrTable(
  memberIds: string[],
  memberLookup: Map<string, string>,
  interactionsByUser: Map<string, InteractionQueryRow[]>,
  leadsByAssignee: Map<string, LeadQueryRow[]>,
  allLeads: LeadQueryRow[],
): SdrPerformanceRow[] {
  return memberIds
    .map((userId) => {
      const userEmail = memberLookup.get(userId) ?? userId.slice(0, 8);
      const userInteractions = interactionsByUser.get(userId) ?? [];
      const userLeads = leadsByAssignee.get(userId) ?? [];
      // Qualified: count leads where this user is won_by (or assigned_to if won_by is null)
      const qualified = allLeads.filter((l) => {
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
  interactions: InteractionQueryRow[],
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
    dailyControl: [],
  };
}

function buildDailyControl(
  memberIds: string[],
  memberLookup: Map<string, string>,
  interactionsByUser: Map<string, InteractionQueryRow[]>,
  leadsByAssignee: Map<string, LeadQueryRow[]>,
): DailyControlRow[] {
  return memberIds.map((userId) => {
    const userInteractions = interactionsByUser.get(userId) ?? [];
    const userLeads = leadsByAssignee.get(userId) ?? [];
    const prospecting = userLeads.filter((l) => l.status === 'contacted' || l.status === 'new').length;
    const available = userLeads.filter((l) => l.status === 'new').length;
    const won = userLeads.filter((l) => l.status === 'qualified').length;
    const lost = userLeads.filter((l) => l.status === 'unqualified').length;

    const completed = userInteractions.filter((i) => ['sent', 'delivered', 'meeting_scheduled'].includes(i.type)).length;
    const calls = userInteractions.filter((i) => i.channel === 'phone').length;
    const emails = userInteractions.filter((i) => i.channel === 'email').length;
    const research = userInteractions.filter((i) => i.channel === 'research' || i.type === 'research').length;

    return {
      userId,
      userName: memberLookup.get(userId) ?? userId.slice(0, 8),
      prospecting,
      available,
      won,
      lost,
      pending: userInteractions.length - completed,
      completed,
      ignored: 0,
      calls,
      emails,
      research,
    };
  }).sort((a, b) => b.completed - a.completed);
}
