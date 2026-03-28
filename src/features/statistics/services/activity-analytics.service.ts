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
  ChannelVolumeEntry,
  DailyActivityEntry,
  GoalData,
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

  return { kpis, channelVolume, dailyTrend, activityTypes, goal };
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
