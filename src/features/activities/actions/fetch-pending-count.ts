'use server';

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { EXECUTOR_IA } from '../utils/fila-humana';

export async function fetchPendingActivitiesCount(): Promise<number> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return 0;
  const { supabase, userId, role } = auth.data;

  // Mirrors the lte filter in fetch-pending-activities so the badge count
  // matches the queue length the SDR actually sees. O RLS de cadence_enrollments
  // é só org-wide (não escopa por SDR), então o join leads!inner + filtro por
  // assigned_to é o que torna o contador PESSOAL — sem ele, o SDR contava a org
  // inteira (o "fila 27 vs stat 517"). Manager conta tudo.
  let query = from(supabase, 'cadence_enrollments')
    .select('id, leads!inner(id), cadences!inner(id)', { count: 'exact', head: true })
    .eq('status', 'active')
    // Passos executados pela IA (Ana) não são trabalho do SDR — mesmo filtro da fila
    .neq('cadences.executor', EXECUTOR_IA)
    .not('next_step_due', 'is', null)
    .lte('next_step_due', new Date().toISOString());
  if (role !== 'manager') query = query.eq('leads.assigned_to', userId);
  const { count } = (await query) as { count: number | null };

  return count ?? 0;
}
