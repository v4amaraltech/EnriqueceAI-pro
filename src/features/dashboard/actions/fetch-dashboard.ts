'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { DashboardMetrics, EnrichmentStats, ImportSummary } from '../dashboard.contract';

type Period = '7d' | '30d' | '90d';

function getPeriodDate(period: Period): string {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

export async function fetchDashboardMetrics(
  period: Period = '30d',
): Promise<ActionResult<DashboardMetrics>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const sinceDate = getPeriodDate(period);

  // Fetch leads (non-deleted) for the org within period
  const { data: leads, error: leadsError } = (await from(supabase, 'leads')
    .select('status, enrichment_status, porte, endereco, created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('created_at', sinceDate)) as {
    data: Array<{
      status: string;
      enrichment_status: string;
      porte: string | null;
      endereco: { uf?: string } | null;
      created_at: string;
    }> | null;
    error: { message: string } | null;
  };

  if (leadsError) {
    return { success: false, error: 'Erro ao buscar métricas' };
  }

  const allLeads = leads ?? [];

  // Leads by status
  const leadsByStatus: Record<string, number> = {};
  for (const lead of allLeads) {
    leadsByStatus[lead.status] = (leadsByStatus[lead.status] ?? 0) + 1;
  }

  // Enrichment stats
  const enrichmentCounts = { enriched: 0, pending: 0, failed: 0, notFound: 0, enriching: 0 };
  for (const lead of allLeads) {
    if (lead.enrichment_status === 'enriched') enrichmentCounts.enriched++;
    else if (lead.enrichment_status === 'pending') enrichmentCounts.pending++;
    else if (lead.enrichment_status === 'enrichment_failed') enrichmentCounts.failed++;
    else if (lead.enrichment_status === 'not_found') enrichmentCounts.notFound++;
    else if (lead.enrichment_status === 'enriching') enrichmentCounts.enriching++;
  }

  const enrichmentStats: EnrichmentStats = {
    total: allLeads.length,
    enriched: enrichmentCounts.enriched,
    pending: enrichmentCounts.pending + enrichmentCounts.enriching,
    failed: enrichmentCounts.failed,
    notFound: enrichmentCounts.notFound,
    successRate: allLeads.length > 0
      ? Math.round((enrichmentCounts.enriched / allLeads.length) * 100)
      : 0,
  };

  // Leads by porte
  const leadsByPorte: Record<string, number> = {};
  for (const lead of allLeads) {
    const porte = lead.porte ?? 'Não informado';
    leadsByPorte[porte] = (leadsByPorte[porte] ?? 0) + 1;
  }

  // Leads by UF
  const leadsByUf: Record<string, number> = {};
  for (const lead of allLeads) {
    const uf = lead.endereco?.uf ?? 'N/A';
    leadsByUf[uf] = (leadsByUf[uf] ?? 0) + 1;
  }

  // Recent imports (last 5)
  const { data: imports } = (await from(supabase, 'lead_imports')
    .select('id, file_name, total_rows, success_count, error_count, status, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(5)) as { data: ImportSummary[] | null };

  return {
    success: true,
    data: {
      leadsByStatus,
      totalLeads: allLeads.length,
      recentImports: imports ?? [],
      enrichmentStats,
      leadsByPorte,
      leadsByUf,
    },
  };
}
