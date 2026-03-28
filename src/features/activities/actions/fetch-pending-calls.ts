'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export interface PendingCallLead {
  enrollmentId: string;
  leadId: string;
  leadName: string;
  nextStepDue: string;
}

export async function fetchPendingCalls(): Promise<ActionResult<PendingCallLead[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  // Active enrollments where next step is a phone call
  const { data: enrollments, error } = (await from(supabase, 'cadence_enrollments')
    .select('id, cadence_id, lead_id, current_step, next_step_due, lead:leads(id, nome_fantasia, razao_social, cnpj)')
    .eq('status', 'active')
    .lte('next_step_due', new Date().toISOString())
    .order('next_step_due', { ascending: true })
    .limit(20)) as {
      data: Array<{
        id: string;
        cadence_id: string;
        lead_id: string;
        current_step: number;
        next_step_due: string;
        lead: { id: string; nome_fantasia: string | null; razao_social: string | null; cnpj: string } | null;
      }> | null;
      error: { message: string } | null;
    };

  if (error || !enrollments) {
    return { success: true, data: [] };
  }

  // Batch-fetch steps for these cadences
  const cadenceIds = [...new Set(enrollments.map((e) => e.cadence_id))];
  const { data: steps } = (await from(supabase, 'cadence_steps')
    .select('cadence_id, step_order, channel')
    .in('cadence_id', cadenceIds)
    .eq('channel', 'phone')) as {
      data: Array<{ cadence_id: string; step_order: number; channel: string }> | null;
    };

  // Build lookup: cadence_id -> set of phone step_orders
  const phoneSteps = new Map<string, Set<number>>();
  for (const s of steps ?? []) {
    const set = phoneSteps.get(s.cadence_id) ?? new Set();
    set.add(s.step_order);
    phoneSteps.set(s.cadence_id, set);
  }

  // Filter enrollments where current step is a phone step
  const result: PendingCallLead[] = [];
  for (const e of enrollments) {
    if (!e.lead) continue;
    const isPhone = phoneSteps.get(e.cadence_id)?.has(e.current_step);
    if (!isPhone) continue;

    result.push({
      enrollmentId: e.id,
      leadId: e.lead.id,
      leadName: e.lead.nome_fantasia ?? e.lead.razao_social ?? e.lead.cnpj,
      nextStepDue: e.next_step_due,
    });
  }

  return { success: true, data: result };
}
