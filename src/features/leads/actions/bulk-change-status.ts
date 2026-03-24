'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export async function bulkChangeStatus(
  leadIds: string[],
  newStatus: 'new' | 'contacted' | 'qualified' | 'unqualified',
): Promise<ActionResult<{ count: number }>> {
  if (leadIds.length === 0) {
    return { success: false, error: 'Nenhum lead selecionado' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { error } = await from(supabase, 'leads')
    .update({ status: newStatus } as Record<string, unknown>)
    .eq('org_id', orgId)
    .in('id', leadIds);

  if (error) {
    return { success: false, error: 'Erro ao alterar status dos leads' };
  }

  revalidatePath('/leads');
  return { success: true, data: { count: leadIds.length } };
}
