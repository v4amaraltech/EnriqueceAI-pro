'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { MAX_BULK_LEAD_IDS } from '@/lib/constants/limits';
import { from } from '@/lib/supabase/from';

import { logLeadEventBulk } from './log-lead-event';

export async function bulkAssignLeads(
  leadIds: string[],
  userId: string,
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

  // Validate target user is active member of org
  const { data: member } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()) as { data: { user_id: string } | null };

  if (!member) {
    return { success: false, error: 'Usuário não é membro ativo da organização' };
  }

  const { error } = await from(supabase, 'leads')
    .update({ assigned_to: userId } as Record<string, unknown>)
    .eq('org_id', orgId)
    .in('id', leadIds);

  if (error) {
    return { success: false, error: 'Erro ao reatribuir leads' };
  }

  // Fetch assigned user name for log message
  const { data: targetUser } = (await from(supabase, 'organization_members')
    .select('full_name')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .single()) as { data: { full_name: string | null } | null };

  logLeadEventBulk(supabase, {
    orgId,
    leadIds,
    userId: auth.data.userId,
    event: 'assigned',
    message: `Responsável alterado para: ${targetUser?.full_name ?? 'Usuário'}`,
    metadata: { assigned_to: userId },
  });

  revalidatePath('/leads');

  return { success: true, data: { count: leadIds.length } };
}
