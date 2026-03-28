'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export interface DialerQueuePhone {
  formatted: string;
  raw: string;
  label: string;
}

export interface DialerQueueItem {
  enrollmentId: string;
  leadId: string;
  leadName: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string;
  phone: string | null;
  phones: DialerQueuePhone[];
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
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  // Active enrollments (all due, regardless of step type)
  // RLS on leads filters by assigned_to for SDRs — !inner excludes enrollments for invisible leads
  const { data: enrollments, error } = (await from(supabase, 'cadence_enrollments')
    .select('id, cadence_id, lead_id, current_step, next_step_due, lead:leads!inner(id, nome_fantasia, razao_social, cnpj, telefone, first_name, last_name, socios), cadence:cadences(id, name)')
    .eq('status', 'active')
    .lte('next_step_due', new Date().toISOString())
    .order('next_step_due', { ascending: true })
    .limit(100)) as {
      data: Array<{
        id: string;
        cadence_id: string;
        lead_id: string;
        current_step: number;
        next_step_due: string;
        lead: { id: string; nome_fantasia: string | null; razao_social: string | null; cnpj: string; telefone: string | null; first_name: string | null; last_name: string | null; socios: Array<{ celulares?: Array<{ ddd: number; numero: string; ranking: number }> }> | null } | null;
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
    from(supabase, 'cadence_steps')
      .select('id, cadence_id, step_order, channel, activity_name, instructions')
      .in('cadence_id', cadenceIds)
      .eq('channel', 'phone') as Promise<{ data: Array<{ id: string; cadence_id: string; step_order: number; channel: string; activity_name: string | null; instructions: string | null }> | null }>,
    from(supabase, 'cadence_steps')
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
  const { data: settings } = (await from(supabase, 'organization_call_settings')
    .select('dialer_daily_limit_per_lead')
    .single()) as { data: { dialer_daily_limit_per_lead: number } | null };

  const dailyLimit = settings?.dialer_daily_limit_per_lead ?? 3;

  // Helper: resolve phone from lead.telefone or socios[0].celulares
  type EnrollmentLead = { telefone: string | null; socios: Array<{ celulares?: Array<{ ddd: number; numero: string; ranking: number }> }> | null };
  function resolvePhone(lead: EnrollmentLead): string | null {
    if (lead.telefone) return lead.telefone;
    const celulares = lead.socios?.[0]?.celulares;
    if (!celulares || celulares.length === 0) return null;
    const best = [...celulares].sort((a, b) => a.ranking - b.ranking)[0];
    if (!best) return null;
    return `(${best.ddd}) ${best.numero}`;
  }

  // Helper: resolve ALL phones from lead for multi-attempt retry
  function resolveAllPhones(lead: EnrollmentLead): DialerQueuePhone[] {
    const phones: DialerQueuePhone[] = [];
    const seen = new Set<string>();

    // Sócio celulares sorted by ranking
    const allCelulares: Array<{ ddd: number; numero: string; ranking: number }> = [];
    for (const socio of lead.socios ?? []) {
      for (const cel of socio.celulares ?? []) {
        allCelulares.push(cel);
      }
    }
    allCelulares.sort((a, b) => a.ranking - b.ranking);

    for (const cel of allCelulares) {
      const cleaned = `${cel.numero}`.replace(/\D/g, '');
      const raw = `55${cel.ddd}${cleaned}`;
      if (seen.has(raw)) continue;
      seen.add(raw);
      const formatted = `(${cel.ddd}) ${cleaned}`;
      phones.push({ formatted, raw, label: formatted });
    }

    // Lead.telefone as fallback
    if (lead.telefone) {
      const cleaned = lead.telefone.replace(/\D/g, '');
      if (!seen.has(cleaned)) {
        phones.push({ formatted: lead.telefone, raw: cleaned, label: `${lead.telefone} (Fixo)` });
      }
    }

    return phones;
  }

  // Filter enrollments from cadences that have ANY phone step
  // (not just enrollments whose current step is phone)
  type Enrollment = (typeof enrollments)[0];
  const phoneEnrollments: Array<{ enrollment: Enrollment; stepInfo: PhoneStepInfo; phone: string }> = [];
  for (const e of enrollments) {
    if (!e.lead || !e.cadence) continue;
    const phoneMap = phoneSteps.get(e.cadence_id);
    if (!phoneMap || phoneMap.size === 0) continue; // cadence has no phone steps at all

    // Resolve phone — skip if lead has no phone at all
    const phone = resolvePhone(e.lead);
    if (!phone) continue;

    // Pick the nearest phone step >= current_step for context (script/activity name)
    // If none ahead, pick the first phone step in the cadence
    let stepInfo: PhoneStepInfo | undefined;
    const sortedOrders = [...phoneMap.keys()].sort((a, b) => a - b);
    for (const order of sortedOrders) {
      if (order >= e.current_step) { stepInfo = phoneMap.get(order); break; }
    }
    if (!stepInfo) stepInfo = phoneMap.get(sortedOrders[0]!);
    if (!stepInfo) continue;

    phoneEnrollments.push({ enrollment: e, stepInfo, phone });
  }

  // Check daily call limits for these leads
  const leadIds = [...new Set(phoneEnrollments.map((pe) => pe.enrollment.lead_id))];
  const callsPerLead = new Map<string, number>();

  if (leadIds.length > 0) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: todayCalls } = (await from(supabase, 'calls')
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
  for (const { enrollment: e, stepInfo, phone } of phoneEnrollments) {
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
      phone,
      phones: resolveAllPhones(e.lead),
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
