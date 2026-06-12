'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

/**
 * Counts distinct leads currently in an ACTIVE manual cadence.
 *
 * Unlike the queue's "today" count (derived from fetchPendingActivities, which
 * only surfaces steps whose next_step_due has already passed), this includes
 * leads whose next step is still in the FUTURE — i.e. the real size of ongoing
 * prospecting. The banner shows this as the headline number, with the "today"
 * count in parentheses.
 *
 * Excludes auto_email cadences (handled by a background job, never in the SDR
 * queue). The leads!inner join makes RLS scope the result: managers see the
 * whole org, SDRs see only their assigned leads.
 */
export async function fetchActiveProspectingCount(): Promise<ActionResult<number>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  // Select lead_id with inner joins so (a) RLS on leads filters invisible rows
  // and (b) we can filter out auto_email cadences. Distinct leads are counted in
  // JS. limit(10000) is a safety ceiling far above any current org's active
  // enrollment volume (~hundreds); revisit with an RPC if an org ever approaches it.
  const { data, error } = (await from(supabase, 'cadence_enrollments')
    .select('lead_id, leads!inner(id), cadences!inner(type)')
    .eq('status', 'active')
    .neq('cadences.type', 'auto_email')
    .is('leads.deleted_at', null)
    .limit(10000)) as {
    data: Array<{ lead_id: string }> | null;
    error: { message: string } | null;
  };

  const qErr = handleQueryError(error, 'Erro ao contar leads em prospecção', 'activities');
  if (qErr) return qErr;

  const distinctLeads = new Set((data ?? []).map((r) => r.lead_id));

  return { success: true, data: distinctLeads.size };
}
