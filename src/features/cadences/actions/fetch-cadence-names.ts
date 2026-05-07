'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

/**
 * Light fetcher that returns the list of active, non-deleted cadence names
 * (standard type only) for the caller's org. Used to populate the cadence
 * filter dropdowns in /atividades, /atividades/log and the power dialer:
 * deriving the list from "what's currently visible in the queue" hides any
 * cadence whose next step is more than a day in the future, which is what
 * happened to "Outbound" after the next_step_due filter was tightened.
 */
export async function fetchActiveCadenceNames(): Promise<ActionResult<string[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'cadences')
    .select('name')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .eq('type', 'standard')
    .is('deleted_at', null)
    .order('name', { ascending: true })) as {
    data: Array<{ name: string }> | null;
    error: { message: string } | null;
  };

  if (error) {
    return { success: false, error: 'Erro ao buscar cadências' };
  }

  const names = [...new Set((data ?? []).map((c) => c.name.trim()))].sort();
  return { success: true, data: names };
}
