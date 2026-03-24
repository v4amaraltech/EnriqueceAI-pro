'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

interface AvailableLeadsData {
  count: number;
  leadIds: string[];
}

/**
 * Counts leads in the org that are NOT enrolled in any active/paused cadence.
 * Returns their IDs so the UI can pass them to EnrollInCadenceDialog.
 */
export async function fetchAvailableLeadsCount(): Promise<ActionResult<AvailableLeadsData>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Get lead IDs already enrolled in active or paused cadences
  const { data: enrolled } = (await from(supabase, 'cadence_enrollments')
    .select('lead_id')
    .in('status', ['active', 'paused'])) as { data: Array<{ lead_id: string }> | null };

  const enrolledIds = [...new Set((enrolled ?? []).map((e) => e.lead_id))];

  // Get available leads (not enrolled, not archived, not deleted)
  let query = from(supabase, 'leads')
    .select('id')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .neq('status', 'archived');

  if (enrolledIds.length > 0) {
    query = query.not('id', 'in', `(${enrolledIds.join(',')})`);
  }

  const { data, error } = (await query) as {
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error('[activities] Failed to fetch available leads count:', error.message);
    return { success: false, error: 'Erro ao contar leads disponíveis' };
  }

  const leadIds = (data ?? []).map((l) => l.id);

  return {
    success: true,
    data: {
      count: leadIds.length,
      leadIds,
    },
  };
}
