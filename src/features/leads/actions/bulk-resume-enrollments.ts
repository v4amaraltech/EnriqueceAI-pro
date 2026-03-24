'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgId } from '@/lib/auth/get-org-id';

export async function bulkResumeEnrollments(
  leadIds: string[],
): Promise<ActionResult<{ count: number }>> {
  if (leadIds.length === 0) {
    return { success: false, error: 'Nenhum lead selecionado' };
  }

  let orgId: string;
  let supabase: Awaited<ReturnType<typeof getAuthOrgId>>['supabase'];
  try {
    const auth = await getAuthOrgId();
    orgId = auth.orgId;
    supabase = auth.supabase;
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  // Get paused enrollments for these leads in org cadences
  const { data: enrollments } = (await supabase
    .from('cadence_enrollments')
    .select('id, lead_id, cadences!inner(org_id)')
    .in('lead_id', leadIds)
    .eq('status', 'paused')
    .eq('cadences.org_id', orgId)) as {
    data: Array<{ id: string }> | null;
  };

  if (!enrollments || enrollments.length === 0) {
    return { success: true, data: { count: 0 } };
  }

  const enrollmentIds = enrollments.map((e) => e.id);
  const { error } = await supabase
    .from('cadence_enrollments')
    .update({ status: 'active' })
    .in('id', enrollmentIds);

  if (error) {
    return { success: false, error: 'Erro ao retomar inscrições' };
  }

  revalidatePath('/leads');
  return { success: true, data: { count: enrollmentIds.length } };
}
