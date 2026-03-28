'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export interface LossReasonOption {
  id: string;
  name: string;
}

export async function fetchLossReasonsForCadence(): Promise<ActionResult<LossReasonOption[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'loss_reasons')
    .select('id, name')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })) as { data: LossReasonOption[] | null; error: unknown };

  if (error) return { success: false, error: 'Erro ao listar motivos de perda' };
  return { success: true, data: data ?? [] };
}
