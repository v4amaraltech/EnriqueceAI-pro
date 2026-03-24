'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export async function bulkAssignLeads(
  leadIds: string[],
  userId: string,
): Promise<ActionResult<{ count: number }>> {
  if (leadIds.length === 0) {
    return { success: false, error: 'Nenhum lead selecionado' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Validate target user is active member of org
  const { data: member } = (await supabase
    .from('organization_members')
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

  revalidatePath('/leads');

  return { success: true, data: { count: leadIds.length } };
}
