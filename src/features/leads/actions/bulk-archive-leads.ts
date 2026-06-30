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
import { logLeadEventBulk } from './log-lead-event';

export async function bulkArchiveLeads(
  leadIds: string[],
): Promise<ActionResult<{ count: number }>> {
  const sizeError = validateBulkLeadIds(leadIds);
  if (sizeError) return { success: false, error: sizeError };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const archivedAt = new Date().toISOString();
  // .select('id') devolve só os leads que eram REALMENTE da org — ids de outra
  // org são silenciosamente ignorados pelo filtro org-scoped. Usamos esses ids
  // confirmados adiante (fecha o IDOR cross-org nos enrollments — S6).
  const { data: updated, error } = (await from(supabase, 'leads')
    .update({ status: 'archived', archived_at: archivedAt } as Record<string, unknown>)
    .eq('org_id', orgId)
    .in('id', leadIds)
    .select('id')) as { data: Array<{ id: string }> | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao arquivar leads' };
  }
  const confirmedIds = (updated ?? []).map((l) => l.id);

  // End any active/paused enrollments so the cadence engine stops scheduling.
  const svc = createServiceRoleClient();
  await endActiveEnrollments(svc, confirmedIds, { status: 'completed', completed_at: archivedAt });

  if (confirmedIds.length > 0) {
    await logLeadEventBulk(supabase, {
      orgId,
      leadIds: confirmedIds,
      userId,
      event: 'lead_archived',
      message: 'Lead arquivado',
    });
  }

  revalidateLeadPaths();

  return { success: true, data: { count: confirmedIds.length } };
}
