'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { MAX_BULK_LEAD_IDS } from '@/lib/constants/limits';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { logLeadEvent } from './log-lead-event';

export async function bulkDeleteLeads(
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

  const { error } = await from(supabase, 'leads')
    .update({ deleted_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('org_id', orgId)
    .in('id', leadIds);

  if (error) {
    return { success: false, error: 'Erro ao excluir leads' };
  }

  // Complete active/paused enrollments for deleted leads so they stop appearing in activity queue
  const serviceClient = createServiceRoleClient();
  await from(serviceClient, 'cadence_enrollments')
    .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
    .in('lead_id', leadIds)
    .in('status', ['active', 'paused']);

  // Timeline event per deleted lead — was missing, so 225 V4 Amaral
  // soft-deletes ended up with no history entry. Fire-and-forget so a
  // single failure doesn't roll back the whole bulk operation.
  for (const leadId of leadIds) {
    logLeadEvent(supabase, {
      orgId,
      leadId,
      userId,
      event: 'lead_archived',
      message: 'Lead arquivado (exclusão em massa)',
      metadata: { system_event: 'lead_archived' },
    });
  }

  revalidatePath('/leads');
  revalidatePath('/atividades');

  return { success: true, data: { count: leadIds.length } };
}
