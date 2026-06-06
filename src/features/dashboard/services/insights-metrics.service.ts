import type { SupabaseClient } from '@supabase/supabase-js';

import { chunkedIn } from '@/lib/supabase/chunked-in';
import { from } from '@/lib/supabase/from';

import type {
  ConversionByOriginEntry,
  DashboardFilters,
  InsightsData,
  LossReasonEntry,
} from '../types';

function getMonthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(year, mon, 0).getDate();
  return {
    start: `${year}-${String(mon).padStart(2, '0')}-01T03:00:00Z`,
    end: `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59-03:00`,
  };
}

function getDateRange(filters: DashboardFilters): { start: string; end: string } {
  if (filters.dateFrom && filters.dateTo) {
    return {
      start: `${filters.dateFrom}T03:00:00Z`,
      end: `${filters.dateTo}T23:59:59-03:00`,
    };
  }
  return getMonthRange(filters.month);
}

/**
 * Chart 1: Loss reasons — horizontal bar chart
 * Counts enrollments with a loss_reason_id, grouped by reason name
 */
export async function fetchLossReasons(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<LossReasonEntry[]> {
  const { start, end } = getDateRange(filters);

  // Loss reason is a canonical lead-level attribute (leads.loss_reason_id),
  // written by markLeadLost / expireInactiveLeads. (Previously read from
  // cadence_enrollments, which only gets the reason for active/paused
  // enrollments — leaving this chart empty for leads lost without an active
  // cadence.) Attribution by lead owner (assigned_to), consistent with the
  // other SDR metrics; auto-loss-by-inactivity is excluded via loss_notes.
  let query = from(supabase, 'leads')
    .select('loss_reason_id, loss_notes, assigned_to')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .not('loss_reason_id', 'is', null)
    .gte('lost_at', start)
    .lt('lost_at', end);

  if (filters.userIds.length > 0) {
    query = query.in('assigned_to', filters.userIds);
  }

  const { data: lostLeads } = (await query) as {
    data: Array<{ loss_reason_id: string; loss_notes: string | null }> | null;
  };

  // Exclude auto-loss-by-inactivity (cron expirations) — not an SDR-chosen reason.
  const rows = (lostLeads ?? []).filter(
    (l) => !(l.loss_notes ?? '').startsWith('Auto-perda por inatividade'),
  );

  if (rows.length === 0) return [];

  // Count by loss_reason_id
  const reasonCounts = new Map<string, number>();
  for (const l of rows) {
    reasonCounts.set(l.loss_reason_id, (reasonCounts.get(l.loss_reason_id) ?? 0) + 1);
  }

  // Fetch reason names
  const reasonIds = [...reasonCounts.keys()];
  const { data: reasons } = (await from(supabase, 'loss_reasons')
    .select('id, name')
    .in('id', reasonIds)) as {
    data: Array<{ id: string; name: string }> | null;
  };

  const reasonMap = new Map<string, string>();
  for (const r of reasons ?? []) {
    reasonMap.set(r.id, r.name);
  }

  // Build entries with percentages
  const total = rows.length;
  const entries: LossReasonEntry[] = [];

  for (const [reasonId, count] of reasonCounts) {
    entries.push({
      reason: reasonMap.get(reasonId) ?? 'Desconhecido',
      count,
      percent: Math.round((count / total) * 100),
    });
  }

  return entries.sort((a, b) => b.count - a.count);
}

const SOURCE_LABELS: Record<string, string> = {
  outbound: 'Outbound',
  leadbroker: 'Leadbroker',
  blackbox: 'Blackbox',
  indicacao: 'Indicação',
  recomendacao: 'Recomendação',
  apollo: 'Apollo',
  reativacao: 'Reativação',
  recuperacao: 'Recuperação',
  api: 'API',
  webhook: 'Webhook',
};

/**
 * Chart 2: Conversion by lead source — stacked bar chart
 * Groups leads by their lead_source field, counts converted vs lost
 */
export async function fetchConversionByOrigin(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<ConversionByOriginEntry[]> {
  const { start, end } = getDateRange(filters);

  // Get leads won or lost in the period (using won_at/lost_at for accuracy)
  let wonQuery = from(supabase, 'leads')
    .select('id, status, lead_source, canal')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .eq('status', 'won')
    .not('won_at', 'is', null)
    .gte('won_at', start)
    .lt('won_at', end);

  let lostQuery = from(supabase, 'leads')
    .select('id, status, lead_source, canal')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .eq('status', 'unqualified')
    .not('lost_at', 'is', null)
    .gte('lost_at', start)
    .lt('lost_at', end);

  if (filters.subOrigins && filters.subOrigins.length > 0) {
    wonQuery = wonQuery.in('canal', filters.subOrigins);
    lostQuery = lostQuery.in('canal', filters.subOrigins);
  }

  const { data: wonLeads } = (await wonQuery) as {
    data: Array<{ id: string; status: string; lead_source: string | null; canal: string | null }> | null;
  };
  const { data: lostLeads } = (await lostQuery) as {
    data: Array<{ id: string; status: string; lead_source: string | null; canal: string | null }> | null;
  };

  // Exclude leads auto-lost by inactivity (cadence queue timeouts). Same
  // rationale as the 'archived' exclusion below: a lead expired by a system
  // timeout was discarded without a real qualification verdict — counting it
  // as "não convertido" buries the origin's true conversion signal (on V4
  // Amaral, 59% of Outbound's losses are auto-expiry). Per-lead marker is an
  // interactions row with metadata.reason='auto_loss_inactivity' (stamped by
  // expireInactiveLeads).
  const lostRaw = lostLeads ?? [];
  const autoLostIds = new Set<string>();
  if (lostRaw.length > 0) {
    const autoRows = await chunkedIn<{ lead_id: string }>(
      lostRaw.map((l) => l.id),
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

  const allLeads = [...(wonLeads ?? []), ...lostRaw.filter((l) => !autoLostIds.has(l.id))];
  // Apply cadence/user filters if needed — build a mutable set of lead IDs
  let filteredLeads = allLeads;

  // If cadence/user filter active, narrow by enrollment
  if (filters.cadenceIds.length > 0 || filters.userIds.length > 0) {
    const leadIds = filteredLeads.map((l) => l.id);
    if (leadIds.length > 0) {
      const enrollments = await chunkedIn<{ lead_id: string }>(leadIds, (chunk) => {
        let q = from(supabase, 'cadence_enrollments')
          .select('lead_id')
          .eq('org_id', orgId)
          .in('lead_id', chunk);
        if (filters.cadenceIds.length > 0) q = q.in('cadence_id', filters.cadenceIds);
        if (filters.userIds.length > 0) q = q.in('enrolled_by', filters.userIds);
        return q as unknown as PromiseLike<{ data: Array<{ lead_id: string }> | null; error: unknown }>;
      });
      const enrolledIds = new Set(enrollments.map((e) => e.lead_id));
      filteredLeads = filteredLeads.filter((l) => enrolledIds.has(l.id));
    }
  }

  if (!filteredLeads.length) return [];

  // When sub-origens filter is active, group by canal (sub-origem) instead of lead_source.
  // This shows one bar per selected sub-origem.
  const groupByCanal = filters.subOrigins && filters.subOrigins.length > 0;

  const sourceStats = new Map<string, { converted: number; lost: number }>();

  for (const lead of filteredLeads) {
    const groupKey = groupByCanal
      ? (lead.canal || 'Sem sub-origem')
      : (lead.lead_source || 'unknown');

    if (lead.status === 'qualified' || lead.status === 'won') {
      const stats = sourceStats.get(groupKey) ?? { converted: 0, lost: 0 };
      stats.converted++;
      sourceStats.set(groupKey, stats);
    } else if (lead.status === 'unqualified') {
      const stats = sourceStats.get(groupKey) ?? { converted: 0, lost: 0 };
      stats.lost++;
      sourceStats.set(groupKey, stats);
    }
    // status='archived' intentionally not counted — archived leads are
    // discarded prospects and shouldn't pollute conversion-by-origin.
  }

  const entries: ConversionByOriginEntry[] = [];
  for (const [source, stats] of sourceStats) {
    if (stats.converted === 0 && stats.lost === 0) continue;
    entries.push({
      origin: groupByCanal ? source : (SOURCE_LABELS[source] ?? source),
      converted: stats.converted,
      lost: stats.lost,
    });
  }

  return entries.sort((a, b) => (b.converted + b.lost) - (a.converted + a.lost));
}

/**
 * Fetch all insights data in parallel
 */
export async function fetchInsightsData(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<InsightsData> {
  const [lossReasons, conversionByOrigin] = await Promise.all([
    fetchLossReasons(supabase, orgId, filters),
    fetchConversionByOrigin(supabase, orgId, filters),
  ]);

  return { lossReasons, conversionByOrigin };
}
