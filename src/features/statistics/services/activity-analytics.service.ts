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
} from '../types/activity-analytics.types';
import { safeRate } from '../types/shared';

interface InteractionRow {
  id: string;
  type: string;
  channel: string | null;
  created_at: string;
  performed_by: string | null;
}

export async function fetchActivityAnalyticsData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
): Promise<ActivityAnalyticsData> {
  let query = from(supabase, 'interactions')
    .select('id, type, channel, created_at, performed_by')
    .eq('org_id', orgId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  if (userIds && userIds.length > 0) {
    query = query.in('performed_by', userIds);
  }

  const { data: rawInteractions } = (await query) as { data: InteractionRow[] | null };
  const interactions = rawInteractions ?? [];

  // Get goal target
  const userId = userIds && userIds.length === 1 ? userIds[0] : undefined;
  const target = await fetchGoalTarget(supabase, orgId, userId);

  const kpis = calculateKpis(interactions, periodStart, target);
  const channelVolume = calculateChannelVolume(interactions);
  const dailyTrend = calculateDailyTrend(interactions, periodStart, periodEnd, target);
  const activityTypes = calculateActivityTypes(interactions);
  const goal = calculateGoal(interactions, target);

  // Fetch leads with status changes in period for won/lost counts
  const { data: rawLeads } = (await from(supabase, 'leads')
    .select('id, status, assigned_to')
    .eq('org_id', orgId)
    .gte('updated_at', periodStart)
    .lte('updated_at', periodEnd)
    .in('status', ['qualified', 'unqualified'])) as {
    data: Array<{ id: string; status: string; assigned_to: string | null }> | null;
  };
  const leads = rawLeads ?? [];

  // Count leads in period (any lead that had an interaction)
  const { data: activeLeads } = (await from(supabase, 'leads')
    .select('id, assigned_to')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd)) as { data: Array<{ id: string; assigned_to: string | null }> | null };

  const leadsInPeriod = (activeLeads ?? []).length;
  const totalWon = leads.filter((l) => l.status === 'qualified').length;
  const totalLost = leads.filter((l) => l.status === 'unqualified').length;

  // Channel completion (% of steps completed vs total per channel)
  const channelCompletion = calculateChannelCompletion(interactions);

  // User breakdown — fetch user names via admin
  const userBreakdown = await calculateUserBreakdown(supabase, orgId, interactions, leads, activeLeads ?? []);

  return { kpis, channelVolume, dailyTrend, activityTypes, goal, leadsInPeriod, totalLost, totalWon, channelCompletion, userBreakdown };
}

async function fetchGoalTarget(
  supabase: SupabaseClient,
  orgId: string,
  userId?: string,
): Promise<number> {
  if (userId) {
    const { data: userGoal } = (await supabase
      .from('daily_activity_goals')
      .select('target')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .single()) as { data: { target: number } | null };

    if (userGoal) return userGoal.target;
  }

  const { data: orgGoal } = (await supabase
    .from('daily_activity_goals')
    .select('target')
    .eq('org_id', orgId)
    .is('user_id', null)
    .single()) as { data: { target: number } | null };

  return orgGoal?.target ?? 20;
}

function calculateKpis(
  interactions: InteractionRow[],
  periodStart: string,
  target: number,
): ActivityAnalyticsKpis {
  const total = interactions.length;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const activitiesToday = interactions.filter(
    (i) => new Date(i.created_at) >= todayStart,
  ).length;

  const start = new Date(periodStart);
  const daysDiff = Math.max(1, Math.ceil((Date.now() - start.getTime()) / (24 * 60 * 60 * 1000)));
  const avgPerDay = Math.round((total / daysDiff) * 10) / 10;

  const goalAchievement = safeRate(avgPerDay, target);

  return { totalActivities: total, activitiesToday, avgPerDay, goalAchievement };
}

function calculateChannelVolume(interactions: InteractionRow[]): ChannelVolumeEntry[] {
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
  interactions: InteractionRow[],
  periodStart: string,
  periodEnd: string,
  target: number,
): DailyActivityEntry[] {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const dayMap = new Map<string, number>();

  for (const interaction of interactions) {
    const day = new Date(interaction.created_at).toISOString().split('T')[0] ?? '';
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }

  const result: DailyActivityEntry[] = [];
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);

  while (current <= end) {
    const key = current.toISOString().split('T')[0] ?? '';
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

function calculateActivityTypes(interactions: InteractionRow[]): ActivityTypeEntry[] {
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

function calculateGoal(interactions: InteractionRow[], target: number): GoalData {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const actual = interactions.filter(
    (i) => new Date(i.created_at) >= todayStart,
  ).length;
  const percentage = safeRate(actual, target);

  return { target, actual, percentage };
}

function calculateChannelCompletion(interactions: InteractionRow[]): ChannelCompletionEntry[] {
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

async function calculateUserBreakdown(
  supabase: SupabaseClient,
  orgId: string,
  interactions: InteractionRow[],
  statusLeads: Array<{ id: string; status: string; assigned_to: string | null }>,
  activeLeads: Array<{ id: string; assigned_to: string | null }>,
): Promise<UserActivityRow[]> {
  // Group interactions by performed_by
  const userMap = new Map<string, InteractionRow[]>();
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

  // Fetch user names
  const { data: authUsers } = await supabase.auth.admin.listUsers({ perPage: 100 });
  const nameMap = new Map<string, string>();
  if (authUsers?.users) {
    for (const u of authUsers.users) {
      const name = (u.user_metadata?.name as string) || (u.user_metadata?.full_name as string) || u.email?.split('@')[0] || u.id.slice(0, 8);
      nameMap.set(u.id, name);
    }
  }

  // Group leads by assigned_to
  const userLeadCount = new Map<string, number>();
  for (const l of activeLeads) {
    if (l.assigned_to) {
      userLeadCount.set(l.assigned_to, (userLeadCount.get(l.assigned_to) ?? 0) + 1);
    }
  }

  const userWon = new Map<string, number>();
  const userLost = new Map<string, number>();
  for (const l of statusLeads) {
    if (!l.assigned_to) continue;
    if (l.status === 'qualified') userWon.set(l.assigned_to, (userWon.get(l.assigned_to) ?? 0) + 1);
    if (l.status === 'unqualified') userLost.set(l.assigned_to, (userLost.get(l.assigned_to) ?? 0) + 1);
  }

  const rows: UserActivityRow[] = [];
  for (const [userId, userInteractions] of userMap) {
    const leads = userLeadCount.get(userId) ?? 0;
    const completed = userInteractions.filter((i) =>
      ['sent', 'delivered', 'meeting_scheduled'].includes(i.type),
    ).length;
    const total = userInteractions.length;
    const won = userWon.get(userId) ?? 0;
    const lost = userLost.get(userId) ?? 0;
    const wonLostTotal = won + lost;

    rows.push({
      userId,
      name: nameMap.get(userId) ?? userId.slice(0, 8),
      leads,
      activitiesCompleted: completed,
      activitiesTotal: total,
      onTimePercent: total > 0 ? safeRate(completed, total) : null,
      lost,
      won,
      wonPercent: wonLostTotal > 0 ? safeRate(won, wonLostTotal) : null,
    });
  }

  return rows.sort((a, b) => b.leads - a.leads);
}
