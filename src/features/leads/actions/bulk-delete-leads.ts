'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import {
  endActiveEnrollments,
  revalidateLeadPaths,
  validateBulkLeadIds,
} from '../services/bulk-leads.service';
import { logLeadEvent } from './log-lead-event';

export async function bulkDeleteLeads(
  leadIds: string[],
): Promise<ActionResult<{ count: number }>> {
  const sizeError = validateBulkLeadIds(leadIds);
  if (sizeError) return { success: false, error: sizeError };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const deletedAt = new Date().toISOString();
  // .select('id') → só os leads confirmados como da org (ids de outra org são
  // ignorados pelo filtro org-scoped). Usamos os confirmados nos enrollments e
  // no log (fecha o IDOR cross-org — S6).
  const { data: updated, error } = (await from(supabase, 'leads')
    .update({ deleted_at: deletedAt } as Record<string, unknown>)
    .eq('org_id', orgId)
    .in('id', leadIds)
    .select('id')) as { data: Array<{ id: string }> | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao excluir leads' };
  }
  const confirmedIds = (updated ?? []).map((l) => l.id);

  // Complete active/paused enrollments so deleted leads leave the activity queue.
  const serviceClient = createServiceRoleClient();
  await endActiveEnrollments(serviceClient, confirmedIds, {
    status: 'completed',
    completed_at: deletedAt,
  });

  // Timeline event per deleted lead — was missing, so 225 V4 Amaral
  // soft-deletes ended up with no history entry. Fire-and-forget so a
  // single failure doesn't roll back the whole bulk operation.
  for (const leadId of confirmedIds) {
    logLeadEvent(supabase, {
      orgId,
      leadId,
      userId,
      event: 'lead_archived',
      message: 'Lead arquivado (exclusão em massa)',
      metadata: { system_event: 'lead_archived' },
    });
  }

  revalidateLeadPaths();

  return { success: true, data: { count: confirmedIds.length } };
}
