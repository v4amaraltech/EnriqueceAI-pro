'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { AvailableCadence } from '../types/start-new-leads';

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
 */
export async function fetchCadencesWithAvailability(): Promise<
  ActionResult<{ cadences: AvailableCadence[]; totalAvailable: number; availableLeadIds: string[] }>
> {
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
    const { data: cadences } = (await from(supabase, 'cadences')
      .select('id, name, origin, total_steps, priority')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('name')) as {
      data: Array<{
        id: string;
        name: string;
        origin: string | null;
        total_steps: number;
        priority: string | null;
      }> | null;
    };

    if (!cadences || cadences.length === 0) {
      return { success: true, data: { cadences: [], totalAvailable: 0, availableLeadIds: [] } };
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
    const baseCountQuery = from(supabase, 'leads_no_active_enrollment')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'new')
      .is('deleted_at', null);
    const baseSampleQuery = from(supabase, 'leads_no_active_enrollment')
      .select('id')
      .eq('org_id', orgId)
      .eq('status', 'new')
      .is('deleted_at', null)
      .limit(200);

    const countQuery = isManager ? baseCountQuery : baseCountQuery.eq('assigned_to', userId);
    const sampleQuery = isManager ? baseSampleQuery : baseSampleQuery.eq('assigned_to', userId);

    const [{ count }, { data: sampleRows }] = await Promise.all([
      countQuery as Promise<{ count: number | null }>,
      sampleQuery as Promise<{ data: Array<{ id: string }> | null }>,
    ]);

    const totalAvailable = count ?? 0;
    const availableLeadIds = (sampleRows ?? []).map((r) => r.id);

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
      data: { cadences: result, totalAvailable, availableLeadIds },
    };
  } catch (err) {
    console.error('[fetch-cadences-with-availability]', err);
    return { success: false, error: 'Erro ao buscar cadências disponíveis' };
  }
}
