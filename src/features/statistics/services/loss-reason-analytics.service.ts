import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { CHART_FALLBACK_COLOR, CHART_SERIES_COLORS } from '@/shared/constants/chart-colors';

import type {
  LossByCadenceRow,
  LossByCadenceStackedRow,
  LossByUserStackedRow,
  LossReasonAnalyticsData,
  LossReasonEntry,
} from '../types/loss-reason-analytics.types';
import type { EnrollmentQueryRow } from '../types/query-rows';
import { groupBy, safeRate } from '../types/shared';
import { buildMemberInfoMap } from './member-lookup';

interface LossReasonRow {
  id: string;
  name: string;
}

interface CadenceRow {
  id: string;
  name: string;
}

export async function fetchLossReasonAnalyticsData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
  cadenceId?: string,
): Promise<LossReasonAnalyticsData> {
  // Fetch cadences for org (used for org isolation + cadence names)
  const { data: rawCadences } = (await from(supabase, 'cadences')
    .select('id, name')
    .eq('org_id', orgId)
    .is('deleted_at', null)) as { data: CadenceRow[] | null };
  const cadences = rawCadences ?? [];

  if (cadences.length === 0) {
    return emptyData();
  }

  // Fetch enrollments scoped to org cadences (cadence_enrollments has no org_id column)
  const cadenceIds = cadenceId ? [cadenceId] : cadences.map((c) => c.id);

  let enrQuery = from(supabase, 'cadence_enrollments')
    .select('cadence_id, lead_id, status, loss_reason_id, enrolled_by')
    .in('cadence_id', cadenceIds)
    .gte('enrolled_at', periodStart)
    .lte('enrolled_at', periodEnd);

  if (userIds && userIds.length > 0) {
    enrQuery = enrQuery.in('enrolled_by', userIds);
  }

  const { data: rawEnrollments } = (await enrQuery) as { data: EnrollmentQueryRow[] | null };
  const enrollments = rawEnrollments ?? [];

  if (enrollments.length === 0) {
    return emptyData();
  }

  // Fetch loss reasons
  const { data: rawReasons } = (await from(supabase, 'loss_reasons')
    .select('id, name')
    .eq('org_id', orgId)) as { data: LossReasonRow[] | null };
  const reasons = rawReasons ?? [];

  const lostEnrollments = enrollments.filter((e) => e.loss_reason_id != null);
  const totalLost = lostEnrollments.length;
  const totalEnrolled = enrollments.length;

  const reasonsRanking = buildReasonsRanking(lostEnrollments, reasons, totalLost);
  const lossByCadence = buildLossByCadence(enrollments, cadences, reasons);
  const lossByCadenceStacked = buildLossByCadenceStacked(lostEnrollments, cadences, reasons);

  // Build user-level stacked data
  const memberInfoMap = await buildMemberInfoMap(supabase, orgId);
  const lossByUserStacked = buildLossByUserStacked(lostEnrollments, reasons, memberInfoMap);

  const topReason = reasonsRanking[0];

  return {
    totalLost,
    topReasonName: topReason?.reasonName ?? '—',
    topReasonCount: topReason?.count ?? 0,
    overallLossRate: safeRate(totalLost, totalEnrolled),
    totalEnrolled,
    reasonsRanking,
    lossByCadence,
    lossByCadenceStacked,
    lossByUserStacked,
  };
}

function buildReasonsRanking(
  lostEnrollments: EnrollmentQueryRow[],
  reasons: LossReasonRow[],
  totalLost: number,
): LossReasonEntry[] {
  const reasonMap = new Map<string, number>();

  for (const enrollment of lostEnrollments) {
    if (enrollment.loss_reason_id) {
      reasonMap.set(enrollment.loss_reason_id, (reasonMap.get(enrollment.loss_reason_id) ?? 0) + 1);
    }
  }

  const reasonLookup = new Map(reasons.map((r) => [r.id, r.name]));

  return Array.from(reasonMap.entries())
    .map(([reasonId, count], index) => ({
      reasonId,
      reasonName: reasonLookup.get(reasonId) ?? 'Desconhecido',
      count,
      percentage: safeRate(count, totalLost),
      color: CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length] ?? CHART_FALLBACK_COLOR,
    }))
    .sort((a, b) => b.count - a.count);
}

function buildLossByCadence(
  enrollments: EnrollmentQueryRow[],
  cadences: CadenceRow[],
  reasons: LossReasonRow[],
): LossByCadenceRow[] {
  const reasonLookup = new Map(reasons.map((r) => [r.id, r.name]));
  const enrollmentsByCadence = groupBy(enrollments, (e) => e.cadence_id);

  return cadences
    .map((cadence) => {
      const cadEnr = enrollmentsByCadence.get(cadence.id) ?? [];
      const cadLost = cadEnr.filter((e) => e.loss_reason_id != null);
      const enrolled = cadEnr.length;
      const lost = cadLost.length;

      // Find top reason for this cadence
      const reasonCounts = new Map<string, number>();
      for (const e of cadLost) {
        if (e.loss_reason_id) {
          reasonCounts.set(e.loss_reason_id, (reasonCounts.get(e.loss_reason_id) ?? 0) + 1);
        }
      }
      let topReasonId = '';
      let topReasonCount = 0;
      for (const [id, count] of reasonCounts) {
        if (count > topReasonCount) {
          topReasonId = id;
          topReasonCount = count;
        }
      }

      return {
        cadenceId: cadence.id,
        cadenceName: cadence.name,
        enrolled,
        lost,
        lossRate: safeRate(lost, enrolled),
        topReason: reasonLookup.get(topReasonId) ?? '—',
      };
    })
    .filter((c) => c.lost > 0)
    .sort((a, b) => b.lost - a.lost);
}

function emptyData(): LossReasonAnalyticsData {
  return {
    totalLost: 0,
    topReasonName: '—',
    topReasonCount: 0,
    overallLossRate: 0,
    totalEnrolled: 0,
    reasonsRanking: [],
    lossByCadence: [],
    lossByCadenceStacked: [],
    lossByUserStacked: [],
  };
}

function buildLossByCadenceStacked(
  lostEnrollments: EnrollmentQueryRow[],
  cadences: CadenceRow[],
  reasons: LossReasonRow[],
): LossByCadenceStackedRow[] {
  const reasonNameMap = new Map(reasons.map((r) => [r.id, r.name]));
  const cadenceNameMap = new Map(cadences.map((c) => [c.id, c.name]));

  // Group by cadence, then by reason
  const cadenceMap = new Map<string, Map<string, number>>();
  for (const e of lostEnrollments) {
    if (!e.loss_reason_id) continue;
    const rMap = cadenceMap.get(e.cadence_id) ?? new Map<string, number>();
    rMap.set(e.loss_reason_id, (rMap.get(e.loss_reason_id) ?? 0) + 1);
    cadenceMap.set(e.cadence_id, rMap);
  }

  const rows: LossByCadenceStackedRow[] = [];
  for (const [cadenceId, reasonMap] of cadenceMap) {
    const totalLost = Array.from(reasonMap.values()).reduce((a, b) => a + b, 0);
    const reasonEntries = Array.from(reasonMap.entries())
      .map(([reasonId, count], idx) => ({
        reasonName: reasonNameMap.get(reasonId) ?? 'Outro',
        count,
        color: CHART_SERIES_COLORS[idx % CHART_SERIES_COLORS.length] ?? CHART_FALLBACK_COLOR,
      }))
      .sort((a, b) => b.count - a.count);

    rows.push({
      cadenceId,
      cadenceName: cadenceNameMap.get(cadenceId) ?? 'Cadência',
      totalLost,
      reasons: reasonEntries,
    });
  }

  return rows.sort((a, b) => b.totalLost - a.totalLost);
}

function buildLossByUserStacked(
  lostEnrollments: EnrollmentQueryRow[],
  reasons: LossReasonRow[],
  memberInfoMap: Map<string, { name: string }>,
): LossByUserStackedRow[] {
  const reasonNameMap = new Map(reasons.map((r) => [r.id, r.name]));

  // Build a global reason → color mapping so colors are consistent across all rows
  const globalReasonIds = new Set<string>();
  for (const e of lostEnrollments) {
    if (e.loss_reason_id) globalReasonIds.add(e.loss_reason_id);
  }
  const reasonColorMap = new Map<string, string>();
  let colorIdx = 0;
  for (const rId of globalReasonIds) {
    reasonColorMap.set(rId, CHART_SERIES_COLORS[colorIdx % CHART_SERIES_COLORS.length] ?? CHART_FALLBACK_COLOR);
    colorIdx++;
  }

  // Group by user
  const userMap = new Map<string, Map<string, number>>();
  for (const e of lostEnrollments) {
    if (!e.loss_reason_id || !e.enrolled_by) continue;
    const rMap = userMap.get(e.enrolled_by) ?? new Map<string, number>();
    rMap.set(e.loss_reason_id, (rMap.get(e.loss_reason_id) ?? 0) + 1);
    userMap.set(e.enrolled_by, rMap);
  }

  const rows: LossByUserStackedRow[] = [];
  for (const [userId, reasonMap] of userMap) {
    const totalLost = Array.from(reasonMap.values()).reduce((a, b) => a + b, 0);
    const reasonEntries = Array.from(reasonMap.entries())
      .map(([reasonId, count]) => ({
        reasonName: reasonNameMap.get(reasonId) ?? 'Outro',
        count,
        color: reasonColorMap.get(reasonId) ?? CHART_FALLBACK_COLOR,
      }))
      .sort((a, b) => b.count - a.count);

    rows.push({
      userId,
      userName: memberInfoMap.get(userId)?.name ?? userId.slice(0, 8),
      totalLost,
      reasons: reasonEntries,
    });
  }

  return rows.sort((a, b) => b.totalLost - a.totalLost);
}
