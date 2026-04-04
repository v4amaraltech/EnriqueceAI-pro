'use server';

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export async function fetchPendingActivitiesCount(): Promise<number> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return 0;
  const { supabase } = auth.data;

  const { count } = (await from(supabase, 'cadence_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .not('next_step_due', 'is', null)) as { count: number | null };

  return count ?? 0;
}
