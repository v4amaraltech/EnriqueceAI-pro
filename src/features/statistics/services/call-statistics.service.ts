import type { SupabaseClient } from '@supabase/supabase-js';

import { isConnectedCall } from '@/features/calls/connection';
import { DISPOSITION_REPORT_LABELS } from '@/features/calls/disposition';
import { isAnsweredByPersonCall, isRelevantConversationCall } from '@/features/calls/effectiveness';
import type { CallDisposition, CallStatus } from '@/features/calls/types';
import { from } from '@/lib/supabase/from';
import { isUuid } from '@/lib/utils/uuid';
import { CALL_EFFECTIVENESS_COLORS } from '@/shared/constants/chart-colors';

import type {
  CallEffectivenessCounts,
  CallEffectivenessData,
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
  answered_at: string | null;
  sdr_disposition: CallDisposition | null;
  hangup_cause: string | null;
  recording_url: string | null;
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
    .select(
      'id, user_id, status, duration_seconds, answered_at, sdr_disposition, hangup_cause, recording_url, started_at',
    )
    .eq('org_id', orgId)
    .gte('started_at', periodStart)
    .lte('started_at', periodEnd);

  const validUserIds = (userIds ?? []).filter(isUuid);
  if (validUserIds.length > 0) {
    query = query.in('user_id', validUserIds);
  }

  const { data: rawCalls } = (await query.limit(10000)) as { data: CallRow[] | null };
  const calls = rawCalls ?? [];

  // Fetch members for name mapping (via admin client — org_members has no email column)
  const memberMap = await buildMemberNameMap(supabase, orgId);

  const kpis = calculateKpis(calls);
  const effectiveness = calculateEffectiveness(calls, memberMap);
  const durationDistribution = calculateDurationDistribution(calls);
  const heatmap = calculateHeatmap(calls);
  const callsBySdr = calculateCallsBySdr(calls, memberMap);

  return { kpis, effectiveness, durationDistribution, heatmap, callsBySdr };
}

function calculateKpis(calls: CallRow[]): CallStatisticsKpis {
  const total = calls.length;
  const totalDuration = calls.reduce((s, c) => s + c.duration_seconds, 0);
  const avg = total > 0 ? Math.round(totalDuration / total) : 0;

  // Best day
  const dayCounts = new Map<string, number>();
  const hourCounts = new Map<number, number>();
  for (const call of calls) {
    // Convert UTC timestamp to BRT (UTC-3) for correct day/hour extraction
    const brt = new Date(new Date(call.started_at).getTime() - 3 * 60 * 60 * 1000);
    const dayKey = DAY_LABELS[brt.getUTCDay()] ?? 'N/A';
    dayCounts.set(dayKey, (dayCounts.get(dayKey) ?? 0) + 1);
    const hour = brt.getUTCHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
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

function emptyCounts(): CallEffectivenessCounts {
  return {
    totalCalls: 0,
    answeredCalls: 0,
    relevantCalls: 0,
    withoutDispositionCalls: 0,
    answeredWithoutDispositionCalls: 0,
  };
}

function addToCounts(counts: CallEffectivenessCounts, call: CallRow): void {
  const answered = isAnsweredByPersonCall(call);
  const withoutDisposition = call.sdr_disposition == null;
  counts.totalCalls++;
  if (answered) counts.answeredCalls++;
  if (isRelevantConversationCall(call)) counts.relevantCalls++;
  if (withoutDisposition) counts.withoutDispositionCalls++;
  if (answered && withoutDisposition) counts.answeredWithoutDispositionCalls++;
}

// Substitui o antigo "Outcomes por Status" (lia só `calls.status`). Org sem
// sinal de telefonia (ex.: webhook API4COM não entregue) aparecia 100% "Não
// Conectada" mesmo com conversas marcadas pelo SDR — ver `features/calls/effectiveness.ts`.
export function calculateEffectiveness(
  calls: CallRow[],
  memberMap: Map<string, string>,
): CallEffectivenessData {
  const total = emptyCounts();
  const bySdr = new Map<string, CallEffectivenessCounts>();
  const byDisposition = new Map<CallDisposition, number>();
  let connectedCalls = 0;
  let hasTelephonyAnswerSignal = false;

  for (const call of calls) {
    addToCounts(total, call);
    if (call.sdr_disposition) {
      byDisposition.set(call.sdr_disposition, (byDisposition.get(call.sdr_disposition) ?? 0) + 1);
    }
    const sdr = bySdr.get(call.user_id) ?? emptyCounts();
    addToCounts(sdr, call);
    bySdr.set(call.user_id, sdr);
    if (isConnectedCall(call)) connectedCalls++;
    if (call.answered_at) hasTelephonyAnswerSignal = true;
  }

  const t = total.totalCalls;

  return {
    summary: {
      ...total,
      connectedCalls,
      connectionRate: safeRate(connectedCalls, t),
      relevantRate: safeRate(total.relevantCalls, t),
      withoutDispositionRate: safeRate(total.withoutDispositionCalls, t),
      hasTelephonyAnswerSignal,
    },
    funnel: [
      { label: 'Discadas', count: t, percentage: t > 0 ? 100 : 0, color: CALL_EFFECTIVENESS_COLORS.dialed },
      {
        label: 'Atendidas',
        count: total.answeredCalls,
        percentage: safeRate(total.answeredCalls, t),
        color: CALL_EFFECTIVENESS_COLORS.answered,
      },
      {
        label: 'Conversa relevante',
        count: total.relevantCalls,
        percentage: safeRate(total.relevantCalls, t),
        color: CALL_EFFECTIVENESS_COLORS.relevant,
      },
    ],
    dispositions: [
      ...(Object.entries(DISPOSITION_REPORT_LABELS) as Array<[CallDisposition, string]>).map(
        ([disposition, label]) => {
          const count = byDisposition.get(disposition) ?? 0;
          return { disposition, label, count, percentage: safeRate(count, t) };
        },
      ),
      {
        disposition: null,
        label: 'Sem desfecho marcado',
        count: total.withoutDispositionCalls,
        percentage: safeRate(total.withoutDispositionCalls, t),
      },
    ],
    bySdr: Array.from(bySdr.entries())
      .map(([userId, c]) => ({
        ...c,
        userId,
        userName: memberMap.get(userId) ?? 'Desconhecido',
        relevantRate: safeRate(c.relevantCalls, c.totalCalls),
        withoutDispositionRate: safeRate(c.withoutDispositionCalls, c.totalCalls),
      }))
      .sort((a, b) => b.totalCalls - a.totalCalls),
  };
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
    // Convert UTC timestamp to BRT (UTC-3) for correct day/hour extraction
    const brt = new Date(new Date(call.started_at).getTime() - 3 * 60 * 60 * 1000);
    const dayIdx = brt.getUTCDay();
    const blockIdx = Math.floor(brt.getUTCHours() / 2);
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
    // Definição canônica — ver `features/calls/connection.ts`. Antes daqui
    // `not_significant` contava sozinha como conectada, inflando a taxa.
    if (isConnectedCall(call)) {
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
