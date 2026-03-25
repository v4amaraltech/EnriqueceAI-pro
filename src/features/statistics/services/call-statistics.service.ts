import type { SupabaseClient } from '@supabase/supabase-js';

import type { CallStatus } from '@/features/calls/types';
import { from } from '@/lib/supabase/from';
import { CALL_STATUS_COLORS, CALL_STATUS_LABELS } from '@/shared/constants/chart-colors';

import type {
  CallOutcomeBarEntry,
  CallStatisticsData,
  CallStatisticsKpis,
  DurationBucket,
  HeatmapCell,
  SdrCallEntry,
} from '../types/call-statistics.types';
import { safeRate } from '../types/shared';
import { buildMemberNameMap } from './member-lookup';

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const DURATION_BUCKETS = [
  { label: '0-30s', min: 0, max: 30 },
  { label: '30s-1m', min: 30, max: 60 },
  { label: '1-2m', min: 60, max: 120 },
  { label: '2-5m', min: 120, max: 300 },
  { label: '5-10m', min: 300, max: 600 },
  { label: '10m+', min: 600, max: Infinity },
];

interface CallRow {
  id: string;
  user_id: string;
  status: CallStatus;
  duration_seconds: number;
  started_at: string;
}

export async function fetchCallStatisticsData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
): Promise<CallStatisticsData> {
  let query = from(supabase, 'calls')
    .select('id, user_id, status, duration_seconds, started_at')
    .eq('org_id', orgId)
    .gte('started_at', periodStart)
    .lte('started_at', periodEnd);

  if (userIds && userIds.length > 0) {
    query = query.in('user_id', userIds);
  }

  const { data: rawCalls } = (await query) as { data: CallRow[] | null };
  const calls = rawCalls ?? [];

  // Fetch members for name mapping (via admin client — org_members has no email column)
  const memberMap = await buildMemberNameMap(supabase, orgId);

  const kpis = calculateKpis(calls);
  const outcomes = calculateOutcomes(calls);
  const durationDistribution = calculateDurationDistribution(calls);
  const heatmap = calculateHeatmap(calls);
  const callsBySdr = calculateCallsBySdr(calls, memberMap);

  return { kpis, outcomes, durationDistribution, heatmap, callsBySdr };
}

function calculateKpis(calls: CallRow[]): CallStatisticsKpis {
  const total = calls.length;
  const totalDuration = calls.reduce((s, c) => s + c.duration_seconds, 0);
  const avg = total > 0 ? Math.round(totalDuration / total) : 0;

  // Best day
  const dayCounts = new Map<string, number>();
  const hourCounts = new Map<number, number>();
  for (const call of calls) {
    const d = new Date(call.started_at);
    const dayKey = DAY_LABELS[d.getDay()] ?? 'N/A';
    dayCounts.set(dayKey, (dayCounts.get(dayKey) ?? 0) + 1);
    hourCounts.set(d.getHours(), (hourCounts.get(d.getHours()) ?? 0) + 1);
  }

  let bestDay = '-';
  let maxDayCount = 0;
  for (const [day, count] of dayCounts) {
    if (count > maxDayCount) {
      maxDayCount = count;
      bestDay = day;
    }
  }

  let bestHour = '-';
  let maxHourCount = 0;
  for (const [hour, count] of hourCounts) {
    if (count > maxHourCount) {
      maxHourCount = count;
      bestHour = `${hour.toString().padStart(2, '0')}h`;
    }
  }

  return {
    totalCalls: total,
    totalDurationSeconds: totalDuration,
    avgDurationSeconds: avg,
    bestDay,
    bestHour,
  };
}

function calculateOutcomes(calls: CallRow[]): CallOutcomeBarEntry[] {
  const total = calls.length;
  const counts = new Map<CallStatus, number>();
  for (const call of calls) {
    counts.set(call.status, (counts.get(call.status) ?? 0) + 1);
  }

  const allStatuses: CallStatus[] = [
    'significant',
    'not_significant',
    'no_contact',
    'busy',
    'not_connected',
  ];

  return allStatuses.map((status) => ({
    status,
    label: CALL_STATUS_LABELS[status],
    count: counts.get(status) ?? 0,
    percentage: safeRate(counts.get(status) ?? 0, total),
    color: CALL_STATUS_COLORS[status],
  }));
}

function calculateDurationDistribution(calls: CallRow[]): DurationBucket[] {
  return DURATION_BUCKETS.map((bucket) => ({
    label: bucket.label,
    range: bucket.label,
    count: calls.filter(
      (c) => c.duration_seconds >= bucket.min && c.duration_seconds < bucket.max,
    ).length,
  }));
}

function calculateHeatmap(calls: CallRow[]): HeatmapCell[] {
  const cells: HeatmapCell[] = [];

  // 7 days x 12 blocks of 2h
  for (let day = 0; day < 7; day++) {
    for (let block = 0; block < 12; block++) {
      const hourStart = block * 2;
      cells.push({
        dayOfWeek: day,
        dayLabel: DAY_LABELS[day]!,
        hourBlock: block,
        hourLabel: `${hourStart.toString().padStart(2, '0')}-${(hourStart + 2).toString().padStart(2, '0')}h`,
        count: 0,
      });
    }
  }

  for (const call of calls) {
    const d = new Date(call.started_at);
    const dayIdx = d.getDay();
    const blockIdx = Math.floor(d.getHours() / 2);
    const cellIdx = dayIdx * 12 + blockIdx;
    const cell = cells[cellIdx];
    if (cell) cell.count++;
  }

  return cells;
}

function calculateCallsBySdr(
  calls: CallRow[],
  memberMap: Map<string, string>,
): SdrCallEntry[] {
  const sdrMap = new Map<string, { total: number; connected: number }>();

  for (const call of calls) {
    const entry = sdrMap.get(call.user_id) ?? { total: 0, connected: 0 };
    entry.total++;
    if (call.status === 'significant' || call.status === 'not_significant') {
      entry.connected++;
    }
    sdrMap.set(call.user_id, entry);
  }

  return Array.from(sdrMap.entries())
    .map(([userId, data]) => ({
      userId,
      userName: memberMap.get(userId) ?? 'Desconhecido',
      totalCalls: data.total,
      connectionRate: safeRate(data.connected, data.total),
    }))
    .sort((a, b) => b.totalCalls - a.totalCalls);
}
