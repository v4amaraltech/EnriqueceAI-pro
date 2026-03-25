import type { SupabaseClient } from '@supabase/supabase-js';

import type { CallStatus } from '@/features/calls/types';
import { from } from '@/lib/supabase/from';
import { safeRate } from '@/features/statistics/types/shared';
import { buildMemberNameMap } from '@/features/statistics/services/member-lookup';

import type {
  ExtratoData,
  ExtratoDailyRow,
  ExtratoKpis,
  ExtratoSdrRow,
} from '../types/extrato';

interface CallRow {
  id: string;
  user_id: string;
  status: CallStatus;
  duration_seconds: number;
  cost: number | null;
  started_at: string;
}

export async function fetchExtratoData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
): Promise<ExtratoData> {
  let callsQuery = from(supabase, 'calls')
    .select('id, user_id, status, duration_seconds, cost, started_at')
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

  const kpis = calculateKpis(calls, periodStart, periodEnd);
  const dailyBreakdown = calculateDailyBreakdown(calls);
  const sdrBreakdown = calculateSdrBreakdown(calls, memberMap);

  return { kpis, dailyBreakdown, sdrBreakdown };
}

function calculateKpis(
  calls: CallRow[],
  periodStart: string,
  periodEnd: string,
): ExtratoKpis {
  const totalCalls = calls.length;
  const totalDurationSeconds = calls.reduce((sum, c) => sum + c.duration_seconds, 0);
  const totalCost = calls.reduce((sum, c) => sum + (c.cost ?? 0), 0);

  const startDate = new Date(periodStart);
  const endDate = new Date(periodEnd);
  const daysDiff = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const avgCallsPerDay = Math.round((totalCalls / daysDiff) * 10) / 10;

  return { totalCalls, totalDurationSeconds, totalCost, avgCallsPerDay };
}

function calculateDailyBreakdown(calls: CallRow[]): ExtratoDailyRow[] {
  const dailyMap = new Map<string, ExtratoDailyRow>();

  for (const call of calls) {
    const date = new Date(call.started_at).toISOString().slice(0, 10);
    const existing = dailyMap.get(date);
    if (existing) {
      existing.calls += 1;
      existing.durationSeconds += call.duration_seconds;
      existing.significantCalls += call.status === 'significant' ? 1 : 0;
      existing.cost += call.cost ?? 0;
    } else {
      dailyMap.set(date, {
        date,
        calls: 1,
        durationSeconds: call.duration_seconds,
        significantCalls: call.status === 'significant' ? 1 : 0,
        cost: call.cost ?? 0,
      });
    }
  }

  return Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function calculateSdrBreakdown(
  calls: CallRow[],
  memberMap: Map<string, string>,
): ExtratoSdrRow[] {
  const sdrMap = new Map<string, { calls: number; totalDuration: number; connected: number; cost: number }>();

  for (const call of calls) {
    const existing = sdrMap.get(call.user_id);
    const isConnected = call.status === 'significant' || call.status === 'not_significant';
    if (existing) {
      existing.calls += 1;
      existing.totalDuration += call.duration_seconds;
      existing.connected += isConnected ? 1 : 0;
      existing.cost += call.cost ?? 0;
    } else {
      sdrMap.set(call.user_id, {
        calls: 1,
        totalDuration: call.duration_seconds,
        connected: isConnected ? 1 : 0,
        cost: call.cost ?? 0,
      });
    }
  }

  return Array.from(sdrMap.entries())
    .map(([userId, data]) => ({
      userId,
      userName: memberMap.get(userId) ?? 'Desconhecido',
      calls: data.calls,
      avgDurationSeconds: data.calls > 0 ? Math.round(data.totalDuration / data.calls) : 0,
      connectionRate: safeRate(data.connected, data.calls),
      cost: data.cost,
    }))
    .sort((a, b) => b.calls - a.calls);
}
