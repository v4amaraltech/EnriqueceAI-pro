import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import type {
  ConversionByOriginEntry,
  DashboardFilters,
  InsightsData,
  LossReasonEntry,
} from '../types';

function getMonthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const start = new Date(year, mon - 1, 1);
  const end = new Date(year, mon, 1);
  return { start: start.toISOString(), end: end.toISOString() };
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
  const { start, end } = getMonthRange(filters.month);

  // Get enrollments with loss reasons — filter by completed_at (when lost), not enrolled_at
  let query = from(supabase, 'cadence_enrollments')
    .select('loss_reason_id, cadence_id, enrolled_by')
    .eq('org_id', orgId)
    .not('loss_reason_id', 'is', null)
    .gte('completed_at', start)
    .lt('completed_at', end);

  if (filters.cadenceIds.length > 0) {
    query = query.in('cadence_id', filters.cadenceIds);
  }
  if (filters.userIds.length > 0) {
    query = query.in('enrolled_by', filters.userIds);
  }

  const { data: enrollments } = (await query) as {
    data: Array<{ loss_reason_id: string }> | null;
  };

  const rows = enrollments ?? [];

  if (rows.length === 0) return [];

  // Count by loss_reason_id
  const reasonCounts = new Map<string, number>();
  for (const e of rows) {
    reasonCounts.set(e.loss_reason_id, (reasonCounts.get(e.loss_reason_id) ?? 0) + 1);
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
  const { start, end } = getMonthRange(filters.month);

  // Get leads that changed to qualified/unqualified in the period
  let leadsQuery = from(supabase, 'leads')
    .select('id, status, lead_source')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .in('status', ['qualified', 'unqualified'])
    .gte('updated_at', start)
    .lt('updated_at', end);

  // If cadence/user filter active, narrow by enrollment
  if (filters.cadenceIds.length > 0 || filters.userIds.length > 0) {
    let enrollmentQuery = from(supabase, 'cadence_enrollments')
      .select('lead_id')
      .eq('org_id', orgId);
    if (filters.cadenceIds.length > 0) enrollmentQuery = enrollmentQuery.in('cadence_id', filters.cadenceIds);
    if (filters.userIds.length > 0) enrollmentQuery = enrollmentQuery.in('enrolled_by', filters.userIds);
    const { data: enrollments } = (await enrollmentQuery) as { data: Array<{ lead_id: string }> | null };
    const enrolledIds = [...new Set((enrollments ?? []).map((e) => e.lead_id))];
    if (enrolledIds.length === 0) return [];
    leadsQuery = leadsQuery.in('id', enrolledIds);
  }

  const { data: leads } = (await leadsQuery) as {
    data: Array<{ id: string; status: string; lead_source: string | null }> | null;
  };

  if (!leads?.length) return [];

  // Group by lead_source: count converted (qualified) vs lost (unqualified/archived)
  const sourceStats = new Map<string, { converted: number; lost: number }>();

  for (const lead of leads ?? []) {
    const source = lead.lead_source || 'unknown';

    if (lead.status === 'qualified') {
      const stats = sourceStats.get(source) ?? { converted: 0, lost: 0 };
      stats.converted++;
      sourceStats.set(source, stats);
    } else if (lead.status === 'unqualified' || lead.status === 'archived') {
      const stats = sourceStats.get(source) ?? { converted: 0, lost: 0 };
      stats.lost++;
      sourceStats.set(source, stats);
    }
  }

  const entries: ConversionByOriginEntry[] = [];
  for (const [source, stats] of sourceStats) {
    if (stats.converted === 0 && stats.lost === 0) continue;
    entries.push({
      origin: SOURCE_LABELS[source] ?? source,
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
