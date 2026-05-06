'use server';

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export async function fetchPendingActivitiesCount(): Promise<number> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return 0;
  const { supabase } = auth.data;

  // Mirrors the lte filter in fetch-pending-activities so the badge count
  // matches the queue length the SDR actually sees.
  const { count } = (await from(supabase, 'cadence_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .not('next_step_due', 'is', null)
    .lte('next_step_due', new Date().toISOString())) as { count: number | null };

  return count ?? 0;
}
