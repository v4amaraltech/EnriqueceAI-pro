'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export interface ActiveCadence {
  id: string;
  name: string;
  total_steps: number;
}

export async function fetchActiveCadences(): Promise<ActionResult<ActiveCadence[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'cadences')
    .select('id, name, total_steps')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('name')) as { data: ActiveCadence[] | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao buscar cadências' };
  }

  return { success: true, data: data ?? [] };
}
