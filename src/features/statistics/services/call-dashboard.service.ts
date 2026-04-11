import type { SupabaseClient } from '@supabase/supabase-js';

import type { CallStatus } from '@/features/calls/types';
import { from } from '@/lib/supabase/from';
import { CALL_STATUS_COLORS, CALL_STATUS_LABELS } from '@/shared/constants/chart-colors';

import type {
  CallDashboardData,
  CallDashboardKpis,
  CallOutcomeEntry,
  HourlyCallEntry,
} from '../types/call-dashboard.types';
import { safeRate } from '../types/shared';
import { buildMemberNameMap } from './member-lookup';

interface CallRow {
  id: string;
  user_id: string;
  destination: string;
  status: CallStatus;
  duration_seconds: number;
  started_at: string;
}

export async function fetchCallDashboardData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
): Promise<CallDashboardData> {
  // Fetch calls
  let callsQuery = from(supabase, 'calls')
    .select('id, user_id, destination, status, duration_seconds, started_at')
    .eq('org_id', orgId)
    .gte('started_at', periodStart)
    .lte('started_at', periodEnd)
    .order('started_at', { ascending: false });

  if (userIds && userIds.length > 0) {
    callsQuery = callsQuery.in('user_id', userIds);
  }

  const { data: rawCalls } = (await callsQuery) as { data: CallRow[] | null };
  const calls = rawCalls ?? [];

  // Fetch members for name mapping (via admin client — org_members has no email column)
  const memberMap = await buildMemberNameMap(supabase, orgId);

  const kpis = calculateKpis(calls);
  const outcomes = calculateOutcomes(calls);
  const hourlyDistribution = calculateHourlyDistribution(calls);
  const recentCalls = calls.slice(0, 10).map((c) => ({
    id: c.id,
    userName: memberMap.get(c.user_id) ?? 'Desconhecido',
    destination: c.destination,
    status: c.status,
    durationSeconds: c.duration_seconds,
    startedAt: c.started_at,
  }));

  return { kpis, outcomes, hourlyDistribution, recentCalls };
}

function calculateKpis(calls: CallRow[]): CallDashboardKpis {
  const totalCalls = calls.length;
  const totalDuration = calls.reduce((sum, c) => sum + c.duration_seconds, 0);
  const avgDurationSeconds = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;

  const CONNECTED_THRESHOLD = 50; // seconds — >= 50s = Conectada
  const connected = calls.filter((c) => c.duration_seconds >= CONNECTED_THRESHOLD).length;
  const significant = connected;

  return {
    totalCalls,
    avgDurationSeconds,
    connectionRate: safeRate(connected, totalCalls),
    significantRate: safeRate(significant, totalCalls),
  };
}

function calculateOutcomes(calls: CallRow[]): CallOutcomeEntry[] {
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

  return allStatuses
    .map((status) => ({
      status,
      label: CALL_STATUS_LABELS[status],
      count: counts.get(status) ?? 0,
      percentage: safeRate(counts.get(status) ?? 0, total),
      color: CALL_STATUS_COLORS[status],
    }))
    .filter((e) => e.count > 0);
}

function calculateHourlyDistribution(calls: CallRow[]): HourlyCallEntry[] {
  const hourCounts = new Array<number>(24).fill(0);

  for (const call of calls) {
    const hour = new Date(call.started_at).getHours();
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
  }

  return hourCounts.map((count, hour) => ({
    hour,
    label: `${hour.toString().padStart(2, '0')}h`,
    count,
  }));
}
