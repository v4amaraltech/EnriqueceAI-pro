import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import type {
  RankingMetric,
  SdrComparisonRow,
  SdrGoalEntry,
  SdrRankingEntry,
  SdrTrendEntry,
  TeamAnalyticsData,
} from '../types/team-analytics.types';
import { safeRate } from '../types/shared';
import { buildMemberNameMap } from './member-lookup';

interface MemberInfo {
  user_id: string;
  displayName: string;
}

interface InteractionRow {
  id: string;
  type: string;
  lead_id: string;
  performed_by: string | null;
  created_at: string;
}

interface EnrollmentRow {
  lead_id: string;
  enrolled_by: string | null;
  status: string;
}

interface CallRow {
  id: string;
  user_id: string;
  status: string;
}

interface LeadRow {
  id: string;
  status: string;
  created_by: string | null;
}

export async function fetchTeamAnalyticsData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<TeamAnalyticsData> {
  // Fetch member name map (via admin client — org_members has no email column)
  const nameMap = await buildMemberNameMap(supabase, orgId);

  // Get member user_ids
  const { data: rawMemberIds } = (await supabase
    .from('organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('status', 'active')) as { data: { user_id: string }[] | null };

  const members: MemberInfo[] = (rawMemberIds ?? []).map((m) => ({
    user_id: m.user_id,
    displayName: nameMap.get(m.user_id) ?? m.user_id.slice(0, 8),
  }));

  const { data: rawInteractions } = (await from(supabase, 'interactions')
    .select('id, type, lead_id, performed_by, created_at')
    .eq('org_id', orgId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd)) as { data: InteractionRow[] | null };

  const { data: rawEnrollments } = (await from(supabase, 'cadence_enrollments')
    .select('lead_id, enrolled_by, status')
    .eq('org_id', orgId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd)) as { data: EnrollmentRow[] | null };

  const { data: rawCalls } = (await from(supabase, 'calls')
    .select('id, user_id, status')
    .eq('org_id', orgId)
    .gte('started_at', periodStart)
    .lte('started_at', periodEnd)) as { data: CallRow[] | null };

  const { data: rawLeads } = (await from(supabase, 'leads')
    .select('id, status, created_by')
    .eq('org_id', orgId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd)) as { data: LeadRow[] | null };

  const interactions = rawInteractions ?? [];
  const enrollments = rawEnrollments ?? [];
  const calls = rawCalls ?? [];
  const leads = rawLeads ?? [];

  // Fetch goals
  const { data: goalRows } = (await supabase
    .from('daily_activity_goals')
    .select('user_id, target')
    .eq('org_id', orgId)) as { data: { user_id: string | null; target: number }[] | null };

  const goalMap = new Map<string | null, number>();
  for (const g of goalRows ?? []) {
    goalMap.set(g.user_id, g.target);
  }
  const defaultTarget = goalMap.get(null) ?? 20;

  const memberMap = new Map(members.map((m) => [m.user_id, m.displayName]));

  const comparison = buildComparison(members, interactions, enrollments, calls, leads, goalMap, defaultTarget);
  const sdrNames = members.map((m) => m.displayName);
  const trends = buildTrends(members, interactions, periodStart, periodEnd, memberMap);
  const rankings = buildRankings(comparison);
  const goals = buildGoals(members, interactions, goalMap, defaultTarget, memberMap);

  return { comparison, trends, sdrNames, rankings, goals };
}

function buildComparison(
  members: MemberInfo[],
  interactions: InteractionRow[],
  enrollments: EnrollmentRow[],
  calls: CallRow[],
  leads: LeadRow[],
  goalMap: Map<string | null, number>,
  defaultTarget: number,
): SdrComparisonRow[] {
  return members.map((member) => {
    const userId = member.user_id;
    const userName = member.displayName;

    const sdrInteractions = interactions.filter((i) => i.performed_by === userId);
    const sdrCalls = calls.filter((c) => c.user_id === userId);
    const sdrLeads = leads.filter((l) => l.created_by === userId);
    const sdrEnrollments = enrollments.filter((e) => e.enrolled_by === userId);

    const replies = sdrInteractions.filter((i) => i.type === 'replied').length;
    const meetings = sdrInteractions.filter((i) => i.type === 'meeting_scheduled').length;

    const repliedOrCompleted = sdrEnrollments.filter(
      (e) => e.status === 'replied' || e.status === 'completed',
    ).length;

    const target = goalMap.get(userId) ?? defaultTarget;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayActivities = sdrInteractions.filter(
      (i) => new Date(i.created_at) >= todayStart,
    ).length;

    return {
      userId,
      userName,
      leads: sdrLeads.length,
      activities: sdrInteractions.length,
      calls: sdrCalls.length,
      replies,
      meetings,
      conversionRate: safeRate(repliedOrCompleted, sdrEnrollments.length),
      goalPercentage: safeRate(todayActivities, target),
    };
  });
}

function buildTrends(
  members: MemberInfo[],
  interactions: InteractionRow[],
  periodStart: string,
  periodEnd: string,
  memberMap: Map<string, string>,
): SdrTrendEntry[] {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);

  // Build day map per SDR
  const sdrDayMap = new Map<string, Map<string, number>>();
  for (const member of members) {
    sdrDayMap.set(member.user_id, new Map());
  }

  for (const interaction of interactions) {
    if (!interaction.performed_by) continue;
    const day = new Date(interaction.created_at).toISOString().split('T')[0]!;
    const dayMap = sdrDayMap.get(interaction.performed_by);
    if (dayMap) {
      dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
    }
  }

  const result: SdrTrendEntry[] = [];
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);

  while (current <= end) {
    const key = current.toISOString().split('T')[0]!;
    const entry: SdrTrendEntry = {
      date: key,
      label: `${current.getDate().toString().padStart(2, '0')}/${(current.getMonth() + 1).toString().padStart(2, '0')}`,
    };

    for (const member of members) {
      const name = memberMap.get(member.user_id) ?? member.displayName;
      const dayMap = sdrDayMap.get(member.user_id);
      entry[name] = dayMap?.get(key) ?? 0;
    }

    result.push(entry);
    current.setDate(current.getDate() + 1);
  }

  return result;
}

function buildRankings(
  comparison: SdrComparisonRow[],
): Record<RankingMetric, SdrRankingEntry[]> {
  const buildRanking = (
    metric: RankingMetric,
    getValue: (r: SdrComparisonRow) => number,
    getLabel: (r: SdrComparisonRow) => string,
  ): SdrRankingEntry[] =>
    [...comparison]
      .sort((a, b) => getValue(b) - getValue(a))
      .map((r) => ({
        userId: r.userId,
        userName: r.userName,
        value: getValue(r),
        label: getLabel(r),
      }));

  return {
    leads: buildRanking('leads', (r) => r.leads, (r) => `${r.leads} leads`),
    activities: buildRanking('activities', (r) => r.activities, (r) => `${r.activities} atividades`),
    calls: buildRanking('calls', (r) => r.calls, (r) => `${r.calls} ligações`),
    conversion: buildRanking('conversion', (r) => r.conversionRate, (r) => `${r.conversionRate}%`),
  };
}

function buildGoals(
  members: MemberInfo[],
  interactions: InteractionRow[],
  goalMap: Map<string | null, number>,
  defaultTarget: number,
  memberMap: Map<string, string>,
): SdrGoalEntry[] {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  return members.map((member) => {
    const target = goalMap.get(member.user_id) ?? defaultTarget;
    const actual = interactions.filter(
      (i) => i.performed_by === member.user_id && new Date(i.created_at) >= todayStart,
    ).length;

    return {
      userId: member.user_id,
      userName: memberMap.get(member.user_id) ?? member.displayName,
      target,
      actual,
      percentage: safeRate(actual, target),
    };
  });
}
