'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { chunkedIn } from '@/lib/supabase/chunked-in';
import { from } from '@/lib/supabase/from';
import { brtDayStartIso, brtTodayIso } from '@/lib/utils/brt-date';

import type { LeadPhone, LeadSocio } from '@/features/leads/types';

import { entraNaFilaHumana } from '../utils/fila-humana';
import { getAllLeadPhones } from '../utils/resolve-whatsapp-phone';

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
  /**
   * A etapa ATUAL da inscrição é a de ligação. Quando `false`, o item entrou na
   * fila pela próxima etapa de ligação da cadência: concluir pularia as etapas
   * do meio, então a discagem automática não o disca (só o modo manual).
   */
  currentStepIsPhone: boolean;
}

export async function fetchDialerQueue(): Promise<ActionResult<DialerQueueItem[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase, userId, role } = auth.data;

  // Active enrollments (all due, regardless of step type). Fila PESSOAL: SDR só os
  // leads atribuídos a ele (não confiar no RLS — em modo 'all' deixa de escopar);
  // manager, a org toda.
  let queue = from(supabase, 'cadence_enrollments')
    .select('id, cadence_id, lead_id, current_step, next_step_due, lead:leads!inner(id, nome_fantasia, razao_social, cnpj, telefone, first_name, last_name, socios, phones), cadence:cadences(id, name, type, executor)')
    .eq('status', 'active')
    .lte('next_step_due', new Date().toISOString());
  if (role !== 'manager') queue = queue.eq('lead.assigned_to', userId);
  const { data: enrollments, error } = (await queue
    .order('next_step_due', { ascending: true })
    .limit(100)) as {
      data: Array<{
        id: string;
        cadence_id: string;
        lead_id: string;
        current_step: number;
        next_step_due: string;
        lead: { id: string; nome_fantasia: string | null; razao_social: string | null; cnpj: string; telefone: string | null; first_name: string | null; last_name: string | null; socios: LeadSocio[] | null; phones: LeadPhone[] | null } | null;
        cadence: { id: string; name: string; type: string | null; executor: string | null } | null;
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
      .eq('channel', 'phone') as unknown as Promise<{ data: Array<{ id: string; cadence_id: string; step_order: number; channel: string; activity_name: string | null; instructions: string | null }> | null }>,
    from(supabase, 'cadence_steps')
      .select('cadence_id, step_order')
      .in('cadence_id', cadenceIds) as unknown as Promise<{ data: Array<{ cadence_id: string; step_order: number }> | null }>,
  ]);

  // Build lookup: cadence_id -> set of phone step_orders and their data
  interface PhoneStepInfo { id: string; order: number; activityName: string | null; instructions: string | null }
  const phoneSteps = new Map<string, Map<number, PhoneStepInfo>>(); // cadence_id -> (step_order -> step info)
  for (const s of phoneStepsResult.data ?? []) {
    const map = phoneSteps.get(s.cadence_id) ?? new Map();
    map.set(s.step_order, { id: s.id, order: s.step_order, activityName: s.activity_name, instructions: s.instructions });
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

  // Canonical phone resolution: reuse getAllLeadPhones (same util the WhatsApp
  // queue uses, já tolerante a phones em formato string via #319) para que leads
  // cujo número vive SÓ na coluna `leads.phones` (enriquecimento Apollo/Lemit) —
  // ou na forma string das cargas ruins — deixem de ser invisíveis ao Power
  // Dialer. O `phone` primário é o `formatted` do primeiro número resolvido, que
  // casa com os `phones[].formatted` usados como value do seletor de telefone.
  type EnrollmentLead = Parameters<typeof getAllLeadPhones>[0];
  function resolveDialerPhones(lead: EnrollmentLead): DialerQueuePhone[] {
    return getAllLeadPhones(lead).map((p) => ({
      formatted: p.formatted,
      raw: p.raw,
      label: p.label,
    }));
  }

  // Filter enrollments from cadences that have ANY phone step
  // (not just enrollments whose current step is phone)
  type Enrollment = (typeof enrollments)[0];
  const phoneEnrollments: Array<{ enrollment: Enrollment; stepInfo: PhoneStepInfo; phone: string; phones: DialerQueuePhone[] }> = [];
  for (const e of enrollments) {
    if (!e.lead || !e.cadence) continue;
    // Passos de cadência executada pela IA são discados pela Ana (V4 Call), nunca pelo SDR
    if (!entraNaFilaHumana(e.cadence)) continue;
    const phoneMap = phoneSteps.get(e.cadence_id);
    if (!phoneMap || phoneMap.size === 0) continue; // cadence has no phone steps at all

    // Resolve all phones (canonical) — skip if lead has no phone at all
    const phones = resolveDialerPhones(e.lead);
    const phone = phones[0]?.formatted;
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

    phoneEnrollments.push({ enrollment: e, stepInfo, phone, phones });
  }

  // Check daily call limits for these leads
  const leadIds = [...new Set(phoneEnrollments.map((pe) => pe.enrollment.lead_id))];
  const callsPerLead = new Map<string, number>();

  if (leadIds.length > 0) {
    // Start of TODAY in BRT (not the server's UTC midnight). `setHours(0,0,0,0)`
    // on a UTC-clock server counts the daily call limit against the wrong day
    // near midnight BRT.
    const todayStartIso = brtDayStartIso(brtTodayIso());

    const todayCalls = await chunkedIn<{ lead_id: string }>(leadIds, (chunk) =>
      from(supabase, 'calls')
        .select('lead_id')
        .in('lead_id', chunk)
        .gte('started_at', todayStartIso) as unknown as PromiseLike<{
        data: Array<{ lead_id: string }> | null;
        error: unknown;
      }>,
    );

    for (const c of todayCalls) {
      callsPerLead.set(c.lead_id, (callsPerLead.get(c.lead_id) ?? 0) + 1);
    }
  }

  const result: DialerQueueItem[] = [];
  for (const { enrollment: e, stepInfo, phone, phones } of phoneEnrollments) {
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
      phones,
      cadenceName: e.cadence.name,
      cadenceId: e.cadence_id,
      stepId: stepInfo.id,
      stepOrder: e.current_step,
      totalSteps: stepCounts.get(e.cadence_id) ?? 1,
      nextStepDue: e.next_step_due,
      activityName: stepInfo.activityName,
      callScript: stepInfo.instructions,
      currentStepIsPhone: stepInfo.order === e.current_step,
    });
  }

  return { success: true, data: result };
}
