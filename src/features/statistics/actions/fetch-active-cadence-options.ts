'use server';

import { requireManager } from '@/lib/auth/require-manager';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface CadenceOption {
  id: string;
  name: string;
}

export async function fetchActiveCadenceOptions(): Promise<CadenceOption[]> {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await from(supabase, 'organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) return [];

  const { data: cadences } = (await from(supabase, 'cadences')
    .select('id, name')
    .eq('org_id', member.org_id)
    .is('deleted_at', null)
    .order('name', { ascending: true })) as { data: { id: string; name: string }[] | null };

  return (cadences ?? []).map((c) => ({ id: c.id, name: c.name }));
}
