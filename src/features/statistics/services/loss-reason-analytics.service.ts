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

  // Sem early-return em "0 cadências": o ranking org-wide vem de leads, que
  // existem independentemente de cadências. As views por cadência ficam vazias.

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

  const { data: rawEnrollments } = (await enrQuery.limit(10000)) as { data: EnrollmentQueryRow[] | null };
  const enrollments = rawEnrollments ?? [];

  // NÃO retornamos cedo em "0 enrollments": no modo org-wide o ranking vem de
  // leads (um lead perdido sem cadência ativa não tem enrollment, mas conta).

  // Fetch loss reasons
  const { data: rawReasons } = (await from(supabase, 'loss_reasons')
    .select('id, name')
    .eq('org_id', orgId)) as { data: LossReasonRow[] | null };
  const reasons = rawReasons ?? [];

  const lostEnrollments = enrollments.filter((e) => e.loss_reason_id != null);
  const enrollmentLost = lostEnrollments.length;
  const totalEnrolled = enrollments.length;

  const memberInfoMap = await buildMemberInfoMap(supabase, orgId);

  // Views por cadência são enrollment-level por natureza (precisam do vínculo
  // enrollment→cadência).
  const lossByCadence = buildLossByCadence(enrollments, cadences, reasons);
  const lossByCadenceStacked = buildLossByCadenceStacked(lostEnrollments, cadences, reasons);

  // Ranking de motivos + total + por-SDR:
  //  - org-wide (sem filtro de cadência): lê de leads.loss_reason_id (canônico,
  //    igual Dashboard/Relatórios). O enrollment-level subcontava (perde lead
  //    perdido sem cadência, duplica lead multi-cadência, filtra por enrolled_at).
  //  - com filtro de cadência: é uma view por cadência → enrollment-level.
  let reasonsRanking: LossReasonEntry[];
  let lossByUserStacked: LossByUserStackedRow[];
  let totalLost: number;

  if (cadenceId) {
    totalLost = enrollmentLost;
    reasonsRanking = buildReasonsRanking(lostEnrollments, reasons, totalLost);
    const lostLeadIds = [...new Set(lostEnrollments.map((e) => e.lead_id))];
    const { data: lostLeads } = lostLeadIds.length > 0
      ? ((await from(supabase, 'leads').select('id, assigned_to').in('id', lostLeadIds).is('deleted_at', null)) as { data: Array<{ id: string; assigned_to: string | null }> | null })
      : { data: [] as Array<{ id: string; assigned_to: string | null }> };
    const leadAssignedMap = new Map((lostLeads ?? []).map((l) => [l.id, l.assigned_to]));
    lossByUserStacked = buildLossByUserStacked(lostEnrollments, reasons, memberInfoMap, leadAssignedMap);
  } else {
    const leadRows = await fetchLostLeadRows(supabase, orgId, periodStart, periodEnd, userIds);
    totalLost = leadRows.length;
    reasonsRanking = buildReasonsRanking(leadRows, reasons, totalLost);
    lossByUserStacked = buildLossByUserStackedFromLeads(leadRows, reasons, memberInfoMap);
  }

  const topReason = reasonsRanking[0];

  return {
    totalLost,
    topReasonName: topReason?.reasonName ?? '—',
    topReasonCount: topReason?.count ?? 0,
    // Taxa de perda = funil de enrollments (% de enrollments do período que
    // terminaram em perda), mantida enrollment-level mesmo no modo org-wide.
    overallLossRate: safeRate(enrollmentLost, totalEnrolled),
    totalEnrolled,
    reasonsRanking,
    lossByCadence,
    lossByCadenceStacked,
    lossByUserStacked,
  };
}

/**
 * Leads perdidos no período (nível lead, canônico) — fonte do ranking org-wide,
 * igual ao Dashboard/Relatórios. Exclui a auto-perda por inatividade (cron).
 */
async function fetchLostLeadRows(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
): Promise<Array<{ loss_reason_id: string | null; assigned_to: string | null }>> {
  let q = from(supabase, 'leads')
    .select('loss_reason_id, loss_notes, assigned_to')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .not('loss_reason_id', 'is', null)
    .gte('lost_at', periodStart)
    .lte('lost_at', periodEnd);
  if (userIds && userIds.length > 0) q = q.in('assigned_to', userIds);

  const { data } = (await q.limit(10000)) as {
    data: Array<{ loss_reason_id: string | null; loss_notes: string | null; assigned_to: string | null }> | null;
  };
  return (data ?? []).filter((l) => !(l.loss_notes ?? '').startsWith('Auto-perda por inatividade'));
}

/** Por-SDR (nível lead, por assigned_to) — espelha buildLossByUserStacked. */
function buildLossByUserStackedFromLeads(
  leadRows: Array<{ loss_reason_id: string | null; assigned_to: string | null }>,
  reasons: LossReasonRow[],
  memberInfoMap: Map<string, { name: string }>,
): LossByUserStackedRow[] {
  const reasonNameMap = new Map(reasons.map((r) => [r.id, r.name]));

  const globalReasonIds = new Set<string>();
  for (const l of leadRows) if (l.loss_reason_id) globalReasonIds.add(l.loss_reason_id);
  const reasonColorMap = new Map<string, string>();
  let colorIdx = 0;
  for (const rId of globalReasonIds) {
    reasonColorMap.set(rId, CHART_SERIES_COLORS[colorIdx % CHART_SERIES_COLORS.length] ?? CHART_FALLBACK_COLOR);
    colorIdx++;
  }

  const userMap = new Map<string, Map<string, number>>();
  for (const l of leadRows) {
    if (!l.loss_reason_id || !l.assigned_to) continue;
    const rMap = userMap.get(l.assigned_to) ?? new Map<string, number>();
    rMap.set(l.loss_reason_id, (rMap.get(l.loss_reason_id) ?? 0) + 1);
    userMap.set(l.assigned_to, rMap);
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

function buildReasonsRanking(
  lostEnrollments: Array<{ loss_reason_id: string | null }>,
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
  leadAssignedMap: Map<string, string | null>,
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

  // Group by lead's assigned_to (SDR responsible), fallback to enrolled_by
  const userMap = new Map<string, Map<string, number>>();
  for (const e of lostEnrollments) {
    if (!e.loss_reason_id) continue;
    const userId = leadAssignedMap.get(e.lead_id) ?? e.enrolled_by;
    if (!userId) continue;
    const rMap = userMap.get(userId) ?? new Map<string, number>();
    rMap.set(e.loss_reason_id, (rMap.get(e.loss_reason_id) ?? 0) + 1);
    userMap.set(userId, rMap);
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
