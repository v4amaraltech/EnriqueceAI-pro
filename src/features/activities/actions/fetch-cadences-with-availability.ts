'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { AvailableCadence, SubOriginCount } from '../types/start-new-leads';
import { NO_SUB_ORIGIN } from '../types/start-new-leads';

const filtersSchema = z.object({
  /** Canal (sub-origem) values to restrict the pool to. NO_SUB_ORIGIN selects leads without canal. */
  canais: z.array(z.string().max(100)).max(50).default([]),
});

export type FetchCadencesFilters = z.input<typeof filtersSchema>;

type CadenceRow = {
  id: string;
  name: string;
  origin: string | null;
  total_steps: number;
  priority: string | null;
  created_by: string | null;
  executor: string | null;
};

/**
 * Cadences an SDR may enroll leads into from "Iniciar novos leads":
 * the ones they created plus team cadences (created by a manager, or with no
 * creator recorded). BDR IA cadences are never shown to SDRs.
 */
function filterCadencesForSdr(
  cadences: CadenceRow[],
  userId: string,
  managerIds: Set<string>,
): CadenceRow[] {
  return cadences.filter((c) => {
    if (c.executor === 'bdr_ai') return false;
    if (!c.created_by) return true;
    return c.created_by === userId || managerIds.has(c.created_by);
  });
}

/**
 * Builds a PostgREST .or() expression matching the selected canais.
 * NO_SUB_ORIGIN matches leads with canal null or empty string.
 */
function buildCanalOrFilter(canais: string[]): string {
  const parts: string[] = [];
  const named = canais.filter((c) => c !== NO_SUB_ORIGIN);
  if (named.length > 0) {
    const quoted = named
      .map((c) => `"${c.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)
      .join(',');
    parts.push(`canal.in.(${quoted})`);
  }
  if (canais.includes(NO_SUB_ORIGIN)) {
    parts.push('canal.is.null', 'canal.eq.""');
  }
  return parts.join(',');
}

/**
 * Fetches active cadences with count of available leads.
 *
 * "Available" = status='new' AND no active/paused enrollment in any cadence.
 *
 * The status filter is essential — the underlying leads_no_active_enrollment
 * view only excludes leads currently in an enrollment, so without filtering by
 * status the dialog would include terminals (won, unqualified, archived) plus
 * contacted/qualified leads that were already worked on. Operators expect
 * "Iniciar novos leads" to surface untouched leads, not leads they already
 * lost or closed.
 *
 * Optionally filters the pool by canal (sub-origem) so SDRs working multiple
 * segments don't enroll e.g. "Prospecção Fria" leads into a Recovery cadence.
 * subOrigins in the result is always computed over the UNFILTERED pool so the
 * filter chips stay stable while toggling.
 */
export async function fetchCadencesWithAvailability(
  filters?: FetchCadencesFilters,
): Promise<
  ActionResult<{
    cadences: AvailableCadence[];
    totalAvailable: number;
    availableLeadIds: string[];
    subOrigins: SubOriginCount[];
  }>
> {
  const parsedFilters = filtersSchema.safeParse(filters ?? {});
  if (!parsedFilters.success) {
    return { success: false, error: 'Filtros inválidos' };
  }
  const { canais } = parsedFilters.data;
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase: rlsSupabase } = auth.data;

  // Determine role — managers see all org leads, SDRs only their own. Without
  // this filter an SDR could "Iniciar novos leads" and end up enrolling leads
  // assigned to teammates, effectively stealing them from other SDRs' queues.
  const { data: memberRow } = (await from(rlsSupabase, 'organization_members')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .single()) as { data: { role: string } | null };
  const isManager = memberRow?.role === 'manager';

  const supabase = createServiceRoleClient();

  try {
    // 1. Get active cadences
    const { data: allCadences } = (await from(supabase, 'cadences')
      .select('id, name, origin, total_steps, priority, created_by, executor')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('name')) as {
      data: CadenceRow[] | null;
    };

    // SDRs only see their own cadences plus the team ones (created by a
    // manager). BDR IA cadences and cadences created by other SDRs are hidden.
    let cadences = allCadences;
    if (!isManager && allCadences && allCadences.length > 0) {
      const { data: managerRows } = (await from(supabase, 'organization_members')
        .select('user_id')
        .eq('org_id', orgId)
        .eq('role', 'manager')) as { data: Array<{ user_id: string }> | null };
      const managerIds = new Set((managerRows ?? []).map((r) => r.user_id));
      cadences = filterCadencesForSdr(allCadences, userId, managerIds);
    }

    if (!cadences || cadences.length === 0) {
      return {
        success: true,
        data: { cadences: [], totalAvailable: 0, availableLeadIds: [], subOrigins: [] },
      };
    }

    // 2. Count + sample available leads via the leads_no_active_enrollment view.
    // Service role bypasses RLS so org scoping has to be explicit. SDRs are
    // additionally scoped to assigned_to = userId; managers see all.
    //
    // status='new' is the load-bearing filter — the view alone returns won,
    // unqualified, archived, contacted, and qualified leads as long as they
    // have no active enrollment. Until 2026-05-12 the V4 Amaral dialog was
    // showing 1772 "disponíveis" of which only 1064 were new; the other 700+
    // were already-closed leads.
    //
    // The dialog only needs ~200 IDs to enroll, so cap the row read at the same number.
    const canalOrFilter = canais.length > 0 ? buildCanalOrFilter(canais) : '';

    let countQuery = from(supabase, 'leads_no_active_enrollment')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'new')
      .is('deleted_at', null);
    let sampleQuery = from(supabase, 'leads_no_active_enrollment')
      .select('id')
      .eq('org_id', orgId)
      .eq('status', 'new')
      .is('deleted_at', null)
      .limit(200);
    // Sub-origin breakdown is always over the unfiltered pool (no canal filter)
    // so the chips don't disappear as the user toggles them.
    let canalRowsQuery = from(supabase, 'leads_no_active_enrollment')
      .select('canal')
      .eq('org_id', orgId)
      .eq('status', 'new')
      .is('deleted_at', null)
      .limit(5000);

    if (!isManager) {
      countQuery = countQuery.eq('assigned_to', userId);
      sampleQuery = sampleQuery.eq('assigned_to', userId);
      canalRowsQuery = canalRowsQuery.eq('assigned_to', userId);
    }
    if (canalOrFilter) {
      countQuery = countQuery.or(canalOrFilter);
      sampleQuery = sampleQuery.or(canalOrFilter);
    }

    const [{ count }, { data: sampleRows }, { data: canalRows }] = await Promise.all([
      countQuery as unknown as Promise<{ count: number | null }>,
      sampleQuery as unknown as Promise<{ data: Array<{ id: string }> | null }>,
      canalRowsQuery as unknown as Promise<{ data: Array<{ canal: string | null }> | null }>,
    ]);

    const totalAvailable = count ?? 0;
    const availableLeadIds = (sampleRows ?? []).map((r) => r.id);

    const canalCounts = new Map<string, number>();
    for (const row of canalRows ?? []) {
      const key = row.canal && row.canal.trim() !== '' ? row.canal : NO_SUB_ORIGIN;
      canalCounts.set(key, (canalCounts.get(key) ?? 0) + 1);
    }
    const subOrigins: SubOriginCount[] = [...canalCounts.entries()]
      .map(([canal, cnt]) => ({ canal, count: cnt }))
      .sort((a, b) => {
        // NO_SUB_ORIGIN always last; others by count DESC then name
        if (a.canal === NO_SUB_ORIGIN) return 1;
        if (b.canal === NO_SUB_ORIGIN) return -1;
        return b.count - a.count || a.canal.localeCompare(b.canal);
      });

    // 3. Map cadences with availability
    const result: AvailableCadence[] = cadences.map((c) => ({
      id: c.id,
      name: c.name,
      origin: (c.origin as AvailableCadence['origin']) ?? 'outbound',
      availableLeads: totalAvailable,
      totalSteps: c.total_steps,
      firstDayActivities: Math.ceil(c.total_steps * 0.25),
      priority: (c.priority as AvailableCadence['priority']) ?? 'medium',
    }));

    // Sort by priority DESC, then availableLeads DESC
    const priorityOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
    result.sort((a, b) => {
      const pDiff = (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0);
      if (pDiff !== 0) return pDiff;
      return b.availableLeads - a.availableLeads;
    });

    return {
      success: true,
      data: { cadences: result, totalAvailable, availableLeadIds, subOrigins },
    };
  } catch (err) {
    console.error('[fetch-cadences-with-availability]', err);
    return { success: false, error: 'Erro ao buscar cadências disponíveis' };
  }
}
