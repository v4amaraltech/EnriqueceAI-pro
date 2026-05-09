import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import {
  CHANNEL_COLORS,
  CHANNEL_LABELS,
  CHART_FALLBACK_COLOR,
  INTERACTION_TYPE_COLORS,
  INTERACTION_TYPE_LABELS,
} from '@/shared/constants/chart-colors';

import type {
  ActivityAnalyticsData,
  ActivityAnalyticsKpis,
  ActivityTypeEntry,
  ChannelCompletionEntry,
  ChannelVolumeEntry,
  DailyActivityEntry,
  GoalData,
  UserActivityRow,
  UserChannelProgress,
  UserQuartileData,
} from '../types/activity-analytics.types';
import type { InteractionQueryRow } from '../types/query-rows';
import { safeRate } from '../types/shared';
import { buildMemberInfoMap } from './member-lookup';

export async function fetchActivityAnalyticsData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
): Promise<ActivityAnalyticsData> {
  let query = from(supabase, 'interactions')
    .select('id, type, channel, lead_id, created_at, performed_by')
    .eq('org_id', orgId)
    .not('channel', 'in', '(system,calendar)')
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  if (userIds && userIds.length > 0) {
    query = query.in('performed_by', userIds);
  }

  const { data: rawInteractions } = (await query.limit(10000)) as { data: InteractionQueryRow[] | null };
  const interactions = rawInteractions ?? [];

  // Get goal target
  const userId = userIds && userIds.length === 1 ? userIds[0] : undefined;
  const target = await fetchGoalTarget(supabase, orgId, userId);

  const kpis = calculateKpis(interactions, periodStart, target);
  const channelVolume = calculateChannelVolume(interactions);
  const dailyTrend = calculateDailyTrend(interactions, periodStart, periodEnd, target);
  const activityTypes = calculateActivityTypes(interactions);
  const goal = calculateGoal(interactions, target);

  // Fetch leads won/lost in period using accurate timestamps
  const { data: wonLeadsRaw } = (await from(supabase, 'leads')
    .select('id, status, assigned_to')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .eq('status', 'won')
    .not('won_at', 'is', null)
    .gte('won_at', periodStart)
    .lte('won_at', periodEnd)
    .limit(10000)) as {
    data: Array<{ id: string; status: string; assigned_to: string | null }> | null;
  };
  const { data: lostLeadsRaw } = (await from(supabase, 'leads')
    .select('id, status, assigned_to')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .eq('status', 'unqualified')
    .not('lost_at', 'is', null)
    .gte('lost_at', periodStart)
    .lte('lost_at', periodEnd)
    .limit(10000)) as {
    data: Array<{ id: string; status: string; assigned_to: string | null }> | null;
  };
  const leads = [...(wonLeadsRaw ?? []), ...(lostLeadsRaw ?? [])];

  // Count leads in period (any lead that had an interaction)
  const { data: activeLeads } = (await from(supabase, 'leads')
    .select('id, assigned_to, status, created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd)
    .limit(10000)) as { data: Array<{ id: string; assigned_to: string | null; status: string; created_at: string }> | null };

  const allActiveLeads = activeLeads ?? [];
  const leadsInPeriod = allActiveLeads.length;

  // Merge both lead sources for accurate won/lost totals
  const seenIds = new Set<string>();
  let totalWon = 0;
  let totalLost = 0;
  for (const l of leads) {
    seenIds.add(l.id);
    if (l.status === 'qualified') totalWon++;
    if (l.status === 'unqualified') totalLost++;
  }
  for (const l of allActiveLeads) {
    if (seenIds.has(l.id)) continue;
    if (l.status === 'qualified') totalWon++;
    if (l.status === 'unqualified') totalLost++;
  }

  // Channel completion (% of steps completed vs total per channel)
  const channelCompletion = calculateChannelCompletion(interactions);

  // Fetch total leads per SDR (all time, no date filter) for "Leads" column
  const { data: allLeadsForCount } = (await from(supabase, 'leads')
    .select('id, assigned_to')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .limit(10000)) as { data: Array<{ id: string; assigned_to: string | null }> | null };

  const totalLeadsByUser = new Map<string, number>();
  for (const l of allLeadsForCount ?? []) {
    if (l.assigned_to) {
      totalLeadsByUser.set(l.assigned_to, (totalLeadsByUser.get(l.assigned_to) ?? 0) + 1);
    }
  }

  // User breakdown — fetch user names via admin
  const userBreakdown = await calculateUserBreakdown(supabase, orgId, interactions, leads, allActiveLeads, totalLeadsByUser);

  return { kpis, channelVolume, dailyTrend, activityTypes, goal, leadsInPeriod, totalLost, totalWon, channelCompletion, userBreakdown };
}

async function fetchGoalTarget(
  supabase: SupabaseClient,
  orgId: string,
  userId?: string,
): Promise<number> {
  if (userId) {
    const { data: userGoal } = (await from(supabase, 'daily_activity_goals')
      .select('target')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .single()) as { data: { target: number } | null };

    if (userGoal) return userGoal.target;
  }

  const { data: orgGoal } = (await from(supabase, 'daily_activity_goals')
    .select('target')
    .eq('org_id', orgId)
    .is('user_id', null)
    .single()) as { data: { target: number } | null };

  return orgGoal?.target ?? 20;
}

function calculateKpis(
  interactions: InteractionQueryRow[],
  periodStart: string,
  target: number,
): ActivityAnalyticsKpis {
  const total = interactions.length;

  // BRT midnight: shift "now" by -3h then truncate to UTC midnight
  const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const todayStart = new Date(Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate()) + 3 * 60 * 60 * 1000);
  const activitiesToday = interactions.filter(
    (i) => new Date(i.created_at) >= todayStart,
  ).length;

  const start = new Date(periodStart);
  const daysDiff = Math.max(1, Math.ceil((Date.now() - start.getTime()) / (24 * 60 * 60 * 1000)));
  const avgPerDay = Math.round((total / daysDiff) * 10) / 10;

  const goalAchievement = safeRate(avgPerDay, target);

  return { totalActivities: total, activitiesToday, avgPerDay, goalAchievement };
}

function calculateChannelVolume(interactions: InteractionQueryRow[]): ChannelVolumeEntry[] {
  const counts = new Map<string, number>();

  for (const interaction of interactions) {
    const channel = interaction.channel ?? 'email';
    counts.set(channel, (counts.get(channel) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([channel, count]) => ({
      channel,
      label: CHANNEL_LABELS[channel] ?? channel,
      count,
      color: CHANNEL_COLORS[channel] ?? CHART_FALLBACK_COLOR,
    }))
    .sort((a, b) => b.count - a.count);
}

function calculateDailyTrend(
  interactions: InteractionQueryRow[],
  periodStart: string,
  periodEnd: string,
  target: number,
): DailyActivityEntry[] {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const dayMap = new Map<string, number>();

  for (const interaction of interactions) {
    // Convert UTC timestamp to BRT (UTC-3) for correct date grouping
    const brt = new Date(new Date(interaction.created_at).getTime() - 3 * 60 * 60 * 1000);
    const day = brt.toISOString().split('T')[0] ?? '';
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }

  const result: DailyActivityEntry[] = [];
  const current = new Date(start);
  current.setUTCHours(0, 0, 0, 0);

  while (current <= end) {
    // Use BRT-adjusted date for key generation
    const brtCurrent = new Date(current.getTime() - 3 * 60 * 60 * 1000);
    const key = brtCurrent.toISOString().split('T')[0] ?? '';
    result.push({
      date: key,
      label: `${current.getDate().toString().padStart(2, '0')}/${(current.getMonth() + 1).toString().padStart(2, '0')}`,
      count: dayMap.get(key) ?? 0,
      target,
    });
    current.setDate(current.getDate() + 1);
  }

  return result;
}

function calculateActivityTypes(interactions: InteractionQueryRow[]): ActivityTypeEntry[] {
  const total = interactions.length;
  const counts = new Map<string, number>();

  for (const interaction of interactions) {
    counts.set(interaction.type, (counts.get(interaction.type) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([type, count]) => ({
      type,
      label: INTERACTION_TYPE_LABELS[type] ?? type,
      count,
      percentage: safeRate(count, total),
      color: INTERACTION_TYPE_COLORS[type] ?? CHART_FALLBACK_COLOR,
    }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count);
}

function calculateGoal(interactions: InteractionQueryRow[], target: number): GoalData {
  // BRT midnight: shift "now" by -3h then truncate to UTC midnight, shift back
  const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const todayStart = new Date(Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate()) + 3 * 60 * 60 * 1000);
  const actual = interactions.filter(
    (i) => new Date(i.created_at) >= todayStart,
  ).length;
  const percentage = safeRate(actual, target);

  return { target, actual, percentage };
}

function calculateChannelCompletion(interactions: InteractionQueryRow[]): ChannelCompletionEntry[] {
  const channelMap = new Map<string, { total: number; completed: number }>();

  for (const i of interactions) {
    const ch = i.channel ?? 'other';
    const entry = channelMap.get(ch) ?? { total: 0, completed: 0 };
    entry.total++;
    // "completed" = sent, delivered, opened, clicked, replied, meeting_scheduled
    if (['sent', 'delivered', 'opened', 'clicked', 'replied', 'meeting_scheduled'].includes(i.type)) {
      entry.completed++;
    }
    channelMap.set(ch, entry);
  }

  const labelMap: Record<string, string> = { email: 'E-mail', whatsapp: 'WhatsApp', phone: 'Telefone', research: 'Pesquisa', linkedin: 'LinkedIn', calendar: 'Agenda' };

  return Array.from(channelMap.entries())
    .map(([channel, { total, completed }]) => ({
      channel,
      label: labelMap[channel] ?? CHANNEL_LABELS[channel] ?? channel,
      completedPercent: safeRate(completed, total),
    }))
    .sort((a, b) => b.completedPercent - a.completedPercent);
}

const QUARTILE_RANGES = [
  { max: 7, label: 'Quartil 1' },
  { max: 14, label: 'Quartil 2' },
  { max: 30, label: 'Quartil 3' },
  { max: Infinity, label: 'Quartil 4' },
];

function computeQuartiles(
  userLeads: Array<{ created_at: string; status: string }>,
): { leadsInProspection: number; quartiles: UserQuartileData[] } {
  const now = Date.now();
  const prospectionLeads = userLeads.filter(
    (l) => !['qualified', 'unqualified', 'archived'].includes(l.status),
  );
  const total = prospectionLeads.length;
  if (total === 0) return { leadsInProspection: 0, quartiles: [] };

  const counts = [0, 0, 0, 0];
  for (const l of prospectionLeads) {
    const days = Math.floor((now - new Date(l.created_at).getTime()) / (24 * 60 * 60 * 1000));
    for (let i = 0; i < QUARTILE_RANGES.length; i++) {
      const range = QUARTILE_RANGES[i];
      if (range && days <= range.max) {
        counts[i] = (counts[i] ?? 0) + 1;
        break;
      }
    }
  }

  const quartiles: UserQuartileData[] = counts
    .map((count, i) => ({
      quartile: i + 1,
      percent: Math.round((count / total) * 100),
      count,
    }))
    .filter((q) => q.count > 0);

  return { leadsInProspection: total, quartiles };
}

async function calculateUserBreakdown(
  supabase: SupabaseClient,
  orgId: string,
  interactions: InteractionQueryRow[],
  statusLeads: Array<{ id: string; status: string; assigned_to: string | null }>,
  activeLeads: Array<{ id: string; assigned_to: string | null; status: string; created_at: string }>,
  totalLeadsByUser: Map<string, number>,
): Promise<UserActivityRow[]> {
  // Group interactions by performed_by
  const userMap = new Map<string, InteractionQueryRow[]>();
  for (const i of interactions) {
    if (!i.performed_by) continue;
    const arr = userMap.get(i.performed_by) ?? [];
    arr.push(i);
    userMap.set(i.performed_by, arr);
  }

  // Also include users with leads but no interactions
  for (const l of activeLeads) {
    if (l.assigned_to && !userMap.has(l.assigned_to)) {
      userMap.set(l.assigned_to, []);
    }
  }

  if (userMap.size === 0) return [];

  const infoMap = await buildMemberInfoMap(supabase, orgId);

  // Group leads by assigned_to
  const userLeadCount = new Map<string, number>();
  for (const l of activeLeads) {
    if (l.assigned_to) {
      userLeadCount.set(l.assigned_to, (userLeadCount.get(l.assigned_to) ?? 0) + 1);
    }
  }

  // Merge both sources (statusLeads filtered by updated_at + activeLeads filtered by created_at)
  // to catch finalized leads regardless of which date filter matches
  const userWon = new Map<string, number>();
  const userLost = new Map<string, number>();
  const seenLeadIds = new Set<string>();

  for (const l of statusLeads) {
    if (!l.assigned_to || seenLeadIds.has(l.id)) continue;
    seenLeadIds.add(l.id);
    if (l.status === 'qualified') userWon.set(l.assigned_to, (userWon.get(l.assigned_to) ?? 0) + 1);
    if (l.status === 'unqualified') userLost.set(l.assigned_to, (userLost.get(l.assigned_to) ?? 0) + 1);
  }

  for (const l of activeLeads) {
    if (!l.assigned_to || seenLeadIds.has(l.id)) continue;
    seenLeadIds.add(l.id);
    if (l.status === 'qualified') userWon.set(l.assigned_to, (userWon.get(l.assigned_to) ?? 0) + 1);
    if (l.status === 'unqualified') userLost.set(l.assigned_to, (userLost.get(l.assigned_to) ?? 0) + 1);
  }

  const completedTypes = new Set(['sent', 'delivered', 'meeting_scheduled']);

  const rows: UserActivityRow[] = [];
  for (const [userId, userInteractions] of userMap) {
    const leads = userLeadCount.get(userId) ?? 0;
    const completed = userInteractions.filter((i) => completedTypes.has(i.type)).length;
    const total = userInteractions.length;
    const won = userWon.get(userId) ?? 0;
    const lost = userLost.get(userId) ?? 0;
    const wonLostTotal = won + lost;

    // Extra detail fields
    const leadsWithFirstActivity = new Set(userInteractions.map((i) => i.lead_id)).size;
    const inboundReplies = userInteractions.filter((i) => i.type === 'replied').length;
    const phoneCalls = userInteractions.filter((i) => i.channel === 'phone').length;

    // Channel progress breakdown
    const channelMap = new Map<string, { completed: number; total: number }>();
    for (const i of userInteractions) {
      const ch = i.channel ?? 'email';
      const entry = channelMap.get(ch) ?? { completed: 0, total: 0 };
      entry.total++;
      if (completedTypes.has(i.type)) entry.completed++;
      channelMap.set(ch, entry);
    }
    const channelProgress: UserChannelProgress[] = Array.from(channelMap.entries())
      .map(([channel, { completed: comp, total: tot }]) => ({
        channel,
        label: CHANNEL_LABELS[channel] ?? channel,
        completed: comp,
        total: tot,
        color: CHANNEL_COLORS[channel] ?? CHART_FALLBACK_COLOR,
      }))
      .sort((a, b) => b.total - a.total);

    // Quartile distribution for leads in prospection
    const userActiveLeads = activeLeads.filter((l) => l.assigned_to === userId);
    const { leadsInProspection, quartiles } = computeQuartiles(userActiveLeads);

    const memberInfo = infoMap.get(userId);
    rows.push({
      userId,
      name: memberInfo?.name ?? userId.slice(0, 8),
      avatarUrl: memberInfo?.avatarUrl,
      totalLeads: totalLeadsByUser.get(userId) ?? 0,
      leads,
      activitiesCompleted: completed,
      activitiesTotal: total,
      onTimePercent: total > 0 ? safeRate(completed, total) : null,
      lost,
      won,
      wonPercent: wonLostTotal > 0 ? safeRate(won, wonLostTotal) : null,
      leadsWithFirstActivity,
      inboundReplies,
      phoneCalls,
      channelProgress,
      leadsInProspection,
      quartiles,
    });
  }

  return rows.sort((a, b) => b.totalLeads - a.totalLeads);
}
