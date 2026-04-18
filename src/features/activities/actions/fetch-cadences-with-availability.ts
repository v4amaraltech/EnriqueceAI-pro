'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { AvailableCadence } from '../types/start-new-leads';

/**
 * Fetches active cadences with count of available leads (new, not enrolled).
 */
export async function fetchCadencesWithAvailability(): Promise<
  ActionResult<{ cadences: AvailableCadence[]; totalAvailable: number; availableLeadIds: string[] }>
> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId } = auth.data;
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

    // 2. Count available leads via SQL (avoids PostgREST .not('id','in',...) URL limit)
    const { data: availResult } = await (supabase.rpc as any)('leads_without_active_enrollment', {
      p_org_id: orgId,
    }) as { data: Array<{ lead_id: string }> | null };

    const availableLeadIds = (availResult ?? []).map((r: { lead_id: string }) => r.lead_id);
    const totalAvailable = availableLeadIds.length;

    // 3. Map cadences with availability
    const result: AvailableCadence[] = cadences.map((c) => ({
      id: c.id,
      name: c.name,
      origin: (c.origin as AvailableCadence['origin']) ?? 'outbound',
      availableLeads: totalAvailable,
      totalSteps: c.total_steps,
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
      data: { cadences: result, totalAvailable, availableLeadIds: availableLeadIds.slice(0, 200) },
    };
  } catch (err) {
    console.error('[fetch-cadences-with-availability]', err);
    return { success: false, error: 'Erro ao buscar cadências disponíveis' };
  }
}
