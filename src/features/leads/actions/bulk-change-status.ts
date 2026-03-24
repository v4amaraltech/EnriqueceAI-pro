'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export async function bulkChangeStatus(
  leadIds: string[],
  newStatus: 'new' | 'contacted' | 'qualified' | 'unqualified',
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
