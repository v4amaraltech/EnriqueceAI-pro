import type { SupabaseClient } from '@supabase/supabase-js';

import { CHART_FALLBACK_COLOR, CHART_SERIES_COLORS } from '@/shared/constants/chart-colors';

import type {
  LossByCadenceRow,
  LossReasonAnalyticsData,
  LossReasonEntry,
} from '../types/loss-reason-analytics.types';
import { safeRate } from '../types/shared';

interface EnrollmentRow {
  cadence_id: string;
  lead_id: string;
  status: string;
  loss_reason_id: string | null;
  enrolled_by: string | null;
}

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
  // Fetch enrollments
  let enrQuery = (supabase.from('cadence_enrollments') as ReturnType<typeof supabase.from>)
    .select('cadence_id, lead_id, status, loss_reason_id, enrolled_by')
    .eq('org_id', orgId)
    .gte('enrolled_at', periodStart)
    .lte('enrolled_at', periodEnd);

  if (userIds && userIds.length > 0) {
    enrQuery = enrQuery.in('enrolled_by', userIds);
  }
  if (cadenceId) {
    enrQuery = enrQuery.eq('cadence_id', cadenceId);
  }

  const { data: rawEnrollments } = (await enrQuery) as { data: EnrollmentRow[] | null };
  const enrollments = rawEnrollments ?? [];

  if (enrollments.length === 0) {
    return emptyData();
  }

  // Fetch loss reasons
  const { data: rawReasons } = (await (supabase.from('loss_reasons') as ReturnType<typeof supabase.from>)
    .select('id, name')
    .eq('org_id', orgId)) as { data: LossReasonRow[] | null };
  const reasons = rawReasons ?? [];

  // Fetch cadences
  const { data: rawCadences } = (await (supabase.from('cadences') as ReturnType<typeof supabase.from>)
    .select('id, name')
    .eq('org_id', orgId)
    .is('deleted_at', null)) as { data: CadenceRow[] | null };
  const cadences = rawCadences ?? [];

  const lostEnrollments = enrollments.filter((e) => e.loss_reason_id != null);
  const totalLost = lostEnrollments.length;
  const totalEnrolled = enrollments.length;

  const reasonsRanking = buildReasonsRanking(lostEnrollments, reasons, totalLost);
  const lossByCadence = buildLossByCadence(enrollments, cadences, reasons);

  const topReason = reasonsRanking[0];

  return {
    totalLost,
    topReasonName: topReason?.reasonName ?? '—',
    topReasonCount: topReason?.count ?? 0,
    overallLossRate: safeRate(totalLost, totalEnrolled),
    totalEnrolled,
    reasonsRanking,
    lossByCadence,
  };
}

function buildReasonsRanking(
  lostEnrollments: EnrollmentRow[],
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
  enrollments: EnrollmentRow[],
  cadences: CadenceRow[],
  reasons: LossReasonRow[],
): LossByCadenceRow[] {
  const reasonLookup = new Map(reasons.map((r) => [r.id, r.name]));

  return cadences
    .map((cadence) => {
      const cadEnr = enrollments.filter((e) => e.cadence_id === cadence.id);
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
  };
}
