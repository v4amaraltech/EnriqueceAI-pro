'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { AvailableCadence } from '../types/start-new-leads';

interface CadenceRow {
  id: string;
  name: string;
  origin: 'inbound_active' | 'inbound_passive' | 'outbound';
  total_steps: number;
  priority: 'high' | 'medium' | 'low';
}

/**
 * Fetches active cadences with count of available leads (new, not enrolled).
 */
export async function fetchCadencesWithAvailability(): Promise<
  ActionResult<{ cadences: AvailableCadence[]; totalAvailable: number; availableLeadIds: string[] }>
> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // 1. Get active cadences
  const { data: cadences, error: cadErr } = (await from(supabase, 'cadences')
    .select('id, name, origin, total_steps, priority')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('name')) as { data: CadenceRow[] | null; error: { message: string } | null };

  const qErr = handleQueryError(cadErr, 'Erro ao buscar cadências', 'activities');
  if (qErr) return qErr;

  // 2. Get lead IDs already enrolled in active/paused cadences
  const { data: enrolled } = (await from(supabase, 'cadence_enrollments')
    .select('lead_id')
    .in('status', ['active', 'paused'])) as { data: Array<{ lead_id: string }> | null };

  const enrolledIds = new Set((enrolled ?? []).map((e) => e.lead_id));

  // 3. Get available leads (new, not enrolled, not deleted)
  let query = from(supabase, 'leads')
    .select('id')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .eq('status', 'new');

  if (enrolledIds.size > 0) {
    query = query.not('id', 'in', `(${[...enrolledIds].join(',')})`);
  }

  const { data: availableLeads, error: leadsErr } = (await query) as {
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  };

  const leadsQErr = handleQueryError(leadsErr, 'Erro ao buscar leads disponíveis', 'activities');
  if (leadsQErr) return leadsQErr;

  const availableLeadIds = (availableLeads ?? []).map((l) => l.id);
  const totalAvailable = availableLeadIds.length;

  const result: AvailableCadence[] = (cadences ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    origin: c.origin,
    availableLeads: totalAvailable,
    totalSteps: c.total_steps,
    priority: c.priority,
  }));

  // Sort by priority DESC, then availableLeads DESC
  const priorityOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
  result.sort((a, b) => {
    const pDiff = (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0);
    if (pDiff !== 0) return pDiff;
    return b.availableLeads - a.availableLeads;
  });

  return {
    success: true,
    data: { cadences: result, totalAvailable, availableLeadIds },
  };
}
