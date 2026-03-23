'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

export interface ActiveCadence {
  id: string;
  name: string;
  total_steps: number;
}

export async function fetchActiveCadences(): Promise<ActionResult<ActiveCadence[]>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data, error } = (await from(supabase, 'cadences')
    .select('id, name, total_steps')
    .eq('org_id', member.org_id)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('name')) as { data: ActiveCadence[] | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao buscar cadências' };
  }

  return { success: true, data: data ?? [] };
}
