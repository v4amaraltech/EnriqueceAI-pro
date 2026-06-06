import type { SupabaseClient } from '@supabase/supabase-js';

import { chunkedIn } from '@/lib/supabase/chunked-in';
import { from } from '@/lib/supabase/from';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface LossReasonStat {
  reasonId: string;
  reasonName: string;
  count: number;
  percentage: number;
}

export interface ConversionByOriginStat {
  origin: string;
  qualified: number;
  unqualified: number;
  total: number;
  conversionRate: number;
}

export interface ResponseTimeByCadence {
  cadenceId: string;
  cadenceName: string;
  leadsApproached: number;
  withinThreshold: number;
  withinThresholdPct: number;
}

export interface ResponseTimeData {
  thresholdMinutes: number;
  overallPct: number;
  overallCount: number;
  totalLeads: number;
  byCadence: ResponseTimeByCadence[];
}

export interface StatisticsData {
  lossReasons: LossReasonStat[];
  conversionByOrigin: ConversionByOriginStat[];
  responseTime: ResponseTimeData;
}

export interface StatisticsFilters {
  periodStart: string;
  periodEnd: string;
  userIds?: string[];
  thresholdMinutes?: number;
}

// ──────────────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────────────

export async function fetchLossReasonStats(
  supabase: SupabaseClient,
  orgId: string,
  filters: StatisticsFilters,
): Promise<LossReasonStat[]> {
  // Get loss reasons for the org
  const { data: reasons } = await from(supabase, 'loss_reasons')
    .select('id, name')
    .eq('org_id', orgId) as { data: { id: string; name: string }[] | null };

  if (!reasons || reasons.length === 0) return [];

  // Get enrollments with loss_reason_id in period
  // Loss reasons are read from the lead_lost interaction (authoritative source).
  // The enrollment-side copy (cadence_enrollments.loss_reason_id) is unreliable:
  // markLeadLost only stamps active/paused enrollments, so leads lost without an
  // active cadence never land a reason there — leaving this empty despite real
  // losses.
  let query = from(supabase, 'interactions')
    .select('metadata, performed_by')
    .eq('org_id', orgId)
    .eq('channel', 'system')
    .eq('metadata->>system_event', 'lead_lost')
    .not('metadata->>loss_reason_id', 'is', null)
    .gte('created_at', filters.periodStart)
    .lte('created_at', filters.periodEnd);

  if (filters.userIds && filters.userIds.length > 0) {
    query = query.in('performed_by', filters.userIds);
  }

  const { data: interactions } = await query as {
    data: { metadata: Record<string, unknown> | null }[] | null;
  };

  if (!interactions || interactions.length === 0) return [];

  // Exclude auto-loss-by-inactivity (cron expirations), not SDR-chosen loss
  // reasons. expireInactiveLeads() stamps metadata.reason = 'auto_loss_inactivity'.
  // Total is recomputed from qualified-only rows so percentages reflect real loss.
  const qualified = interactions.filter(
    (i) => i.metadata?.reason !== 'auto_loss_inactivity' && i.metadata?.loss_reason_id != null,
  );

  if (qualified.length === 0) return [];

  const total = qualified.length;
  const countMap = new Map<string, number>();

  for (const i of qualified) {
    const reasonId = String(i.metadata?.loss_reason_id);
    countMap.set(reasonId, (countMap.get(reasonId) ?? 0) + 1);
  }

  return reasons
    .map((r) => {
      const count = countMap.get(r.id) ?? 0;
      return {
        reasonId: r.id,
        reasonName: r.name,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

export async function fetchConversionByOrigin(
  supabase: SupabaseClient,
  orgId: string,
  filters: StatisticsFilters,
): Promise<ConversionByOriginStat[]> {
  let query = from(supabase, 'leads')
    .select('id, status, created_by')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('created_at', filters.periodStart)
    .lte('created_at', filters.periodEnd);

  if (filters.userIds && filters.userIds.length > 0) {
    query = query.in('created_by', filters.userIds);
  }

  const { data: leads } = await query as {
    data: { id: string; status: string; created_by: string | null }[] | null;
  };

  if (!leads || leads.length === 0) return [];

  // Exclude leads auto-lost by inactivity (cadence queue timeouts): discarded
  // by a system timeout, not a real qualification verdict, so they shouldn't
  // drag the origin's conversion rate down. Per-lead marker is an interactions
  // row with metadata.reason='auto_loss_inactivity' (stamped by expireInactiveLeads).
  const lostIds = leads
    .filter((l) => l.status === 'unqualified' || l.status === 'archived')
    .map((l) => l.id);
  const autoLostIds = new Set<string>();
  if (lostIds.length > 0) {
    const autoRows = await chunkedIn<{ lead_id: string }>(
      lostIds,
      (chunk) =>
        from(supabase, 'interactions')
          .select('lead_id')
          .eq('org_id', orgId)
          .in('lead_id', chunk)
          .filter('metadata->>reason', 'eq', 'auto_loss_inactivity') as unknown as PromiseLike<{
          data: Array<{ lead_id: string }> | null;
          error: unknown;
        }>,
    );
    for (const r of autoRows) autoLostIds.add(r.lead_id);
  }

  // Group by created_by as "origin" (user who created)
  // For now, origin = created_by user ID (we label it in the UI)
  const originMap = new Map<string, { qualified: number; unqualified: number }>();

  for (const lead of leads) {
    if (autoLostIds.has(lead.id)) continue; // skip auto-loss-by-inactivity artifacts
    const origin = lead.created_by ?? 'unknown';
    const current = originMap.get(origin) ?? { qualified: 0, unqualified: 0 };

    if (lead.status === 'qualified' || lead.status === 'won') {
      current.qualified++;
    } else if (lead.status === 'unqualified' || lead.status === 'archived') {
      current.unqualified++;
    }

    originMap.set(origin, current);
  }

  return Array.from(originMap.entries()).map(([origin, stats]) => {
    const total = stats.qualified + stats.unqualified;
    return {
      origin,
      qualified: stats.qualified,
      unqualified: stats.unqualified,
      total,
      conversionRate: total > 0 ? Math.round((stats.qualified / total) * 100) : 0,
    };
  });
}

export async function fetchResponseTimeData(
  supabase: SupabaseClient,
  orgId: string,
  filters: StatisticsFilters,
): Promise<ResponseTimeData> {
  const thresholdMinutes = filters.thresholdMinutes ?? 60;

  // Get leads created in period
  let leadsQuery = from(supabase, 'leads')
    .select('id, created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('created_at', filters.periodStart)
    .lte('created_at', filters.periodEnd);

  if (filters.userIds && filters.userIds.length > 0) {
    leadsQuery = leadsQuery.in('created_by', filters.userIds);
  }

  const { data: leads } = await leadsQuery as {
    data: { id: string; created_at: string }[] | null;
  };

  if (!leads || leads.length === 0) {
    return {
      thresholdMinutes,
      overallPct: 0,
      overallCount: 0,
      totalLeads: 0,
      byCadence: [],
    };
  }

  const leadIds = leads.map((l) => l.id);

  // Get first interaction per lead
  const { data: interactions } = await from(supabase, 'interactions')
    .select('lead_id, cadence_id, created_at')
    .eq('org_id', orgId)
    .in('lead_id', leadIds)
    .in('type', ['sent', 'delivered'])
    .order('created_at', { ascending: true }) as {
    data: { lead_id: string; cadence_id: string | null; created_at: string }[] | null;
  };

  if (!interactions || interactions.length === 0) {
    return {
      thresholdMinutes,
      overallPct: 0,
      overallCount: 0,
      totalLeads: leads.length,
      byCadence: [],
    };
  }

  // Build map: lead_id -> created_at
  const leadCreatedMap = new Map<string, string>();
  for (const l of leads) {
    leadCreatedMap.set(l.id, l.created_at);
  }

  // First interaction per lead
  const firstInteractionMap = new Map<string, { cadence_id: string | null; created_at: string }>();
  for (const i of interactions) {
    if (!firstInteractionMap.has(i.lead_id)) {
      firstInteractionMap.set(i.lead_id, { cadence_id: i.cadence_id, created_at: i.created_at });
    }
  }

  // Calculate response times
  let withinThresholdTotal = 0;
  const cadenceStats = new Map<string, { leadsApproached: number; withinThreshold: number }>();

  for (const [leadId, firstInt] of firstInteractionMap) {
    const leadCreated = leadCreatedMap.get(leadId);
    if (!leadCreated) continue;

    const diffMs = new Date(firstInt.created_at).getTime() - new Date(leadCreated).getTime();
    const diffMinutes = diffMs / (1000 * 60);
    const isWithin = diffMinutes <= thresholdMinutes;

    if (isWithin) withinThresholdTotal++;

    const cadenceId = firstInt.cadence_id ?? 'no-cadence';
    const current = cadenceStats.get(cadenceId) ?? { leadsApproached: 0, withinThreshold: 0 };
    current.leadsApproached++;
    if (isWithin) current.withinThreshold++;
    cadenceStats.set(cadenceId, current);
  }

  // Get cadence names
  const cadenceIds = Array.from(cadenceStats.keys()).filter((id) => id !== 'no-cadence');
  let cadenceNames = new Map<string, string>();

  if (cadenceIds.length > 0) {
    const { data: cadences } = await from(supabase, 'cadences')
      .select('id, name')
      .in('id', cadenceIds) as { data: { id: string; name: string }[] | null };

    if (cadences) {
      cadenceNames = new Map(cadences.map((c) => [c.id, c.name]));
    }
  }

  const byCadence: ResponseTimeByCadence[] = Array.from(cadenceStats.entries()).map(
    ([cadenceId, stats]) => ({
      cadenceId,
      cadenceName: cadenceId === 'no-cadence' ? 'Sem cadência' : (cadenceNames.get(cadenceId) ?? 'Cadência removida'),
      leadsApproached: stats.leadsApproached,
      withinThreshold: stats.withinThreshold,
      withinThresholdPct:
        stats.leadsApproached > 0
          ? Math.round((stats.withinThreshold / stats.leadsApproached) * 100)
          : 0,
    }),
  );

  const totalApproached = firstInteractionMap.size;

  return {
    thresholdMinutes,
    overallPct: totalApproached > 0 ? Math.round((withinThresholdTotal / totalApproached) * 100) : 0,
    overallCount: withinThresholdTotal,
    totalLeads: leads.length,
    byCadence: byCadence.sort((a, b) => b.leadsApproached - a.leadsApproached),
  };
}
