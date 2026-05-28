'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { MAX_BULK_LEAD_IDS } from '@/lib/constants/limits';
import { from } from '@/lib/supabase/from';

import { logLeadEventBulk } from './log-lead-event';

export async function bulkResumeEnrollments(
  leadIds: string[],
): Promise<ActionResult<{ count: number }>> {
  if (leadIds.length === 0) {
    return { success: false, error: 'Nenhum lead selecionado' };
  }
  if (leadIds.length > MAX_BULK_LEAD_IDS) {
    return { success: false, error: `Máximo de ${MAX_BULK_LEAD_IDS} leads por operação` };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Get paused enrollments for these leads in org cadences
  const { data: enrollments } = (await from(supabase, 'cadence_enrollments')
    .select('id, lead_id, cadences!inner(org_id)')
    .in('lead_id', leadIds)
    .eq('status', 'paused')
    .eq('cadences.org_id', orgId)) as {
    data: Array<{ id: string; lead_id: string }> | null;
  };

  if (!enrollments || enrollments.length === 0) {
    return { success: true, data: { count: 0 } };
  }

  const enrollmentIds = enrollments.map((e) => e.id);
  const { error } = await from(supabase, 'cadence_enrollments')
    .update({ status: 'active' })
    .in('id', enrollmentIds);

  if (error) {
    return { success: false, error: 'Erro ao retomar inscrições' };
  }

  const affectedLeadIds = [...new Set(enrollments.map((e) => e.lead_id))];
  await logLeadEventBulk(supabase, {
    orgId,
    leadIds: affectedLeadIds,
    userId,
    event: 'enrollment_status_changed',
    message: 'Cadência retomada',
  });

  revalidatePath('/leads');
  return { success: true, data: { count: enrollmentIds.length } };
}
