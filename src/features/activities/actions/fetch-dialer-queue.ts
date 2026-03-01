'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface DialerQueueItem {
  enrollmentId: string;
  leadId: string;
  leadName: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string;
  phone: string | null;
  cadenceName: string;
  cadenceId: string;
  stepId: string;
  stepOrder: number;
  totalSteps: number;
  nextStepDue: string;
  activityName: string | null;
  callScript: string | null;
}

export async function fetchDialerQueue(): Promise<ActionResult<DialerQueueItem[]>> {
  await requireAuth();
  const supabase = await createServerSupabaseClient();

  // Active enrollments where next step is due
  const { data: enrollments, error } = (await (supabase
    .from('cadence_enrollments') as ReturnType<typeof supabase.from>)
    .select('id, cadence_id, lead_id, current_step, next_step_due, lead:leads(id, nome_fantasia, razao_social, cnpj, telefone, first_name, last_name), cadence:cadences(id, name)')
    .eq('status', 'active')
    .lte('next_step_due', new Date().toISOString())
    .order('next_step_due', { ascending: true })
    .limit(50)) as {
      data: Array<{
        id: string;
        cadence_id: string;
        lead_id: string;
        current_step: number;
        next_step_due: string;
        lead: { id: string; nome_fantasia: string | null; razao_social: string | null; cnpj: string; telefone: string | null; first_name: string | null; last_name: string | null } | null;
        cadence: { id: string; name: string } | null;
      }> | null;
      error: { message: string } | null;
    };

  if (error || !enrollments) {
    return { success: true, data: [] };
  }

  // Batch-fetch all steps for these cadences (phone only + total count)
  const cadenceIds = [...new Set(enrollments.map((e) => e.cadence_id))];
  if (cadenceIds.length === 0) return { success: true, data: [] };

  const [phoneStepsResult, allStepsResult] = await Promise.all([
    (supabase
      .from('cadence_steps') as ReturnType<typeof supabase.from>)
      .select('id, cadence_id, step_order, channel, activity_name, instructions')
      .in('cadence_id', cadenceIds)
      .eq('channel', 'phone') as Promise<{ data: Array<{ id: string; cadence_id: string; step_order: number; channel: string; activity_name: string | null; instructions: string | null }> | null }>,
    (supabase
      .from('cadence_steps') as ReturnType<typeof supabase.from>)
      .select('cadence_id, step_order')
      .in('cadence_id', cadenceIds) as Promise<{ data: Array<{ cadence_id: string; step_order: number }> | null }>,
  ]);

  // Build lookup: cadence_id -> set of phone step_orders and their data
  interface PhoneStepInfo { id: string; activityName: string | null; instructions: string | null }
  const phoneSteps = new Map<string, Map<number, PhoneStepInfo>>(); // cadence_id -> (step_order -> step info)
  for (const s of phoneStepsResult.data ?? []) {
    const map = phoneSteps.get(s.cadence_id) ?? new Map();
    map.set(s.step_order, { id: s.id, activityName: s.activity_name, instructions: s.instructions });
    phoneSteps.set(s.cadence_id, map);
  }

  // Build total step count per cadence
  const stepCounts = new Map<string, number>();
  for (const s of allStepsResult.data ?? []) {
    stepCounts.set(s.cadence_id, (stepCounts.get(s.cadence_id) ?? 0) + 1);
  }

  // Get daily limit setting
  const { data: settings } = (await (supabase
    .from('organization_call_settings') as ReturnType<typeof supabase.from>)
    .select('dialer_daily_limit_per_lead')
    .single()) as { data: { dialer_daily_limit_per_lead: number } | null };

  const dailyLimit = settings?.dialer_daily_limit_per_lead ?? 3;

  // Filter enrollments where current step is a phone step
  const phoneEnrollments: Array<{ enrollment: typeof enrollments[number]; stepInfo: PhoneStepInfo }> = [];
  for (const e of enrollments) {
    if (!e.lead || !e.cadence) continue;
    const phoneMap = phoneSteps.get(e.cadence_id);
    const stepInfo = phoneMap?.get(e.current_step);
    if (!stepInfo) continue;
    // Exclude leads without phone
    if (!e.lead.telefone) continue;
    phoneEnrollments.push({ enrollment: e, stepInfo });
  }

  // Check daily call limits for these leads
  const leadIds = [...new Set(phoneEnrollments.map((pe) => pe.enrollment.lead_id))];
  const callsPerLead = new Map<string, number>();

  if (leadIds.length > 0) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: todayCalls } = (await (supabase
      .from('calls') as ReturnType<typeof supabase.from>)
      .select('lead_id')
      .in('lead_id', leadIds)
      .gte('started_at', todayStart.toISOString())) as {
      data: Array<{ lead_id: string }> | null;
    };

    for (const c of todayCalls ?? []) {
      callsPerLead.set(c.lead_id, (callsPerLead.get(c.lead_id) ?? 0) + 1);
    }
  }

  const result: DialerQueueItem[] = [];
  for (const { enrollment: e, stepInfo } of phoneEnrollments) {
    if (!e.lead || !e.cadence) continue;
    // Exclude leads at daily limit
    const callCount = callsPerLead.get(e.lead_id) ?? 0;
    if (callCount >= dailyLimit) continue;

    result.push({
      enrollmentId: e.id,
      leadId: e.lead.id,
      leadName: e.lead.nome_fantasia ?? e.lead.razao_social ?? e.lead.cnpj,
      firstName: e.lead.first_name,
      lastName: e.lead.last_name,
      companyName: e.lead.razao_social ?? e.lead.cnpj,
      phone: e.lead.telefone,
      cadenceName: e.cadence.name,
      cadenceId: e.cadence_id,
      stepId: stepInfo.id,
      stepOrder: e.current_step,
      totalSteps: stepCounts.get(e.cadence_id) ?? 1,
      nextStepDue: e.next_step_due,
      activityName: stepInfo.activityName,
      callScript: stepInfo.instructions,
    });
  }

  return { success: true, data: result };
}
