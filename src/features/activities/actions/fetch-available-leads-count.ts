'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

interface AvailableLeadsData {
  count: number;
  leadIds: string[];
}

/**
 * Counts leads in the org that are NOT enrolled in any active/paused cadence.
 * Returns their IDs so the UI can pass them to EnrollInCadenceDialog.
 *
 * Uses leads_no_active_enrollment view — the anti-join runs in SQL so we
 * avoid a NOT IN(...) clause whose URL would exceed the PostgREST limit
 * on orgs with many enrolled leads.
 */
export async function fetchAvailableLeadsCount(): Promise<ActionResult<AvailableLeadsData>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'leads_no_active_enrollment')
    .select('id')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .eq('status', 'new')) as {
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  };

  const qErr = handleQueryError(error, 'Erro ao contar leads disponíveis', 'activities');
  if (qErr) return qErr;

  const leadIds = (data ?? []).map((l) => l.id);

  return {
    success: true,
    data: {
      count: leadIds.length,
      leadIds,
    },
  };
}
