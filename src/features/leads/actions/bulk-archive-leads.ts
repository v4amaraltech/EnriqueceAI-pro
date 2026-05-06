'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { MAX_BULK_LEAD_IDS } from '@/lib/constants/limits';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export async function bulkArchiveLeads(
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
  const { orgId, supabase } = auth.data;

  const archivedAt = new Date().toISOString();
  const { error } = await from(supabase, 'leads')
    .update({ status: 'archived', archived_at: archivedAt } as Record<string, unknown>)
    .eq('org_id', orgId)
    .in('id', leadIds);

  if (error) {
    return { success: false, error: 'Erro ao arquivar leads' };
  }

  // Mirror the single-lead archive: end any active/paused enrollments so the
  // cadence engine stops scheduling activities for these leads. Service role
  // bypasses RLS — scope by lead_id (already verified above by org).
  const svc = createServiceRoleClient();
  await from(svc, 'cadence_enrollments')
    .update({ status: 'completed', completed_at: archivedAt } as Record<string, unknown>)
    .in('lead_id', leadIds)
    .in('status', ['active', 'paused']);

  revalidatePath('/leads');
  revalidatePath('/atividades');

  return { success: true, data: { count: leadIds.length } };
}
