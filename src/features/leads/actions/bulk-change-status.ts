'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { MAX_BULK_LEAD_IDS } from '@/lib/constants/limits';
import { from } from '@/lib/supabase/from';

import { logLeadEventBulk } from './log-lead-event';

const bulkChangeStatusSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1, 'Nenhum lead selecionado').max(MAX_BULK_LEAD_IDS),
  newStatus: z.enum(['new', 'contacted', 'qualified']),
});

export async function bulkChangeStatus(
  leadIds: string[],
  newStatus: 'new' | 'contacted' | 'qualified',
): Promise<ActionResult<{ count: number }>> {
  // Closed backdoor: marking leads 'unqualified' (perdido) MUST go through
  // bulkMarkLeadsLost — it requires a loss reason and writes the lead_lost
  // timeline event. Doing it here skipped both, leaving leads "perdidos" with
  // no motivo and a blank timeline (34 such leads found on V4 Amaral, all
  // status-changed via this path + later deleted). Reject it explicitly, even
  // for non-TS callers that bypass the narrowed type above.
  if ((newStatus as string) === 'unqualified') {
    return {
      success: false,
      error: 'Para dar um lead como perdido use "Marcar como perdido" (exige motivo).',
    };
  }

  const parsed = bulkChangeStatusSchema.safeParse({ leadIds, newStatus });
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const now = new Date().toISOString();
  const timestampField: Record<string, string> = {
    contacted: 'contacted_at',
  };
  const updates: Record<string, unknown> = { status: newStatus };
  const tsField = timestampField[newStatus];
  if (tsField) updates[tsField] = now;

  const { error } = await from(supabase, 'leads')
    .update(updates)
    .eq('org_id', orgId)
    .in('id', leadIds);

  if (error) {
    return { success: false, error: 'Erro ao alterar status dos leads' };
  }

  const statusLabels: Record<string, string> = {
    new: 'Novo', contacted: 'Contactado', qualified: 'Qualificado', won: 'Ganho', unqualified: 'Não Qualificado',
  };
  logLeadEventBulk(supabase, {
    orgId,
    leadIds,
    userId: auth.data.userId,
    event: 'status_changed',
    message: `Status alterado para: ${statusLabels[newStatus] ?? newStatus}`,
    metadata: { new_status: newStatus },
  });

  revalidatePath('/leads');
  return { success: true, data: { count: leadIds.length } };
}
