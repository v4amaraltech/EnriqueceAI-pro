'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { chunkedIn } from '@/lib/supabase/chunked-in';
import { from } from '@/lib/supabase/from';
import { brtDayStartIso, brtTodayIso } from '@/lib/utils/brt-date';

import type { LeadPhone, LeadSocio } from '@/features/leads/types';

import { isCallPriorityV2Enabled } from '@/features/contact-engine/services/call-priority.service';
import type { NextLeadInteraction } from '@/features/cockpit/utils/next-lead';

import type { DialerStats } from '../schemas/dialer-preferences.schemas';
import { countCallsByPhone, phoneKey } from '../utils/auto-dialer';
import { entraNaFilaHumana } from '../utils/fila-humana';
import { rankDialerQueue } from '../utils/rank-dialer-queue';
import { getAllLeadPhones } from '../utils/resolve-whatsapp-phone';

export interface DialerQueuePhone {
  formatted: string;
  raw: string;
  label: string;
}

/** Ligações de hoje (BRT) para um número do lead. */
export interface DialerPhoneAttempt {
  phone: string;
  attemptsToday: number;
  lastAttemptAt: string | null;
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
  /**
   * Tentativas de hoje por número (story power-dialer-rounds). O limite diário
   * (`dialer_daily_limit_per_lead`) vale POR NÚMERO; o lead sai da fila só
   * quando todos os números o atingiram.
   */
  phoneAttempts: DialerPhoneAttempt[];
}

export interface DialerQueueWithStats {
  items: DialerQueueItem[];
  /**
   * Números do card "Leads fora da fila", contados com a MESMA regra que monta
   * a fila acima (antes vinham de uma consulta à parte, com outra regra, e não
   * batiam com a lista).
   */
  stats: DialerStats;
  /** Flag `call_priority_v2` ligada para a org do viewer. */
  priorityQueueEnabled: boolean;
}

const EMPTY_STATS: DialerStats = { leadsWithoutPhone: 0, leadsAtDailyLimit: 0, leadsWithSnooze: 0, totalAvailable: 0 };

export async function fetchDialerQueue(): Promise<ActionResult<DialerQueueItem[]>> {
  const result = await fetchDialerQueueWithStats();
  if (!result.success) return result;
  return { success: true, data: result.data.items };
}

export async function fetchDialerQueueWithStats(): Promise<ActionResult<DialerQueueWithStats>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase, userId, role, orgId } = auth.data;
  const priorityQueueEnabled = await isCallPriorityV2Enabled({ orgId, userId });
  const now = new Date();
  const nowIso = now.toISOString();

  // Active enrollments (all due, regardless of step type). Fila PESSOAL: SDR só os
  // leads atribuídos a ele (não confiar no RLS — em modo 'all' deixa de escopar);
  // manager, a org toda.
  const enrollmentSelect = 'id, cadence_id, lead_id, current_step, next_step_due, lead:leads!inner(id, nome_fantasia, razao_social, cnpj, telefone, first_name, last_name, socios, phones), cadence:cadences(id, name, type, executor)';
  let queue = from(supabase, 'cadence_enrollments')
    .select(enrollmentSelect)
    .eq('status', 'active')
    .lte('next_step_due', nowIso);
  if (role !== 'manager') queue = queue.eq('lead.assigned_to', userId);
  const { data: dueEnrollments, error } = (await queue
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

  if (error || !dueEnrollments) {
    return { success: true, data: { items: [], stats: EMPTY_STATS, priorityQueueEnabled } };
  }

  const enrollments = priorityQueueEnabled
    ? await includeSignaledDueEnrollments({
        supabase,
        orgId,
        userId,
        role,
        existing: dueEnrollments,
        now,
        select: enrollmentSelect,
      })
    : dueEnrollments;

  // Batch-fetch all steps for these cadences (phone only + total count)
  const cadenceIds = [...new Set(enrollments.map((e) => e.cadence_id))];
  if (cadenceIds.length === 0) return { success: true, data: { items: [], stats: EMPTY_STATS, priorityQueueEnabled } };

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
  let leadsWithoutPhone = 0;
  for (const e of enrollments) {
    if (!e.lead || !e.cadence) continue;
    // Passos de cadência executada pela IA são discados pela Ana (V4 Call), nunca pelo SDR
    if (!entraNaFilaHumana(e.cadence)) continue;
    const phoneMap = phoneSteps.get(e.cadence_id);
    if (!phoneMap || phoneMap.size === 0) continue; // cadence has no phone steps at all

    // Resolve all phones (canonical) — skip if lead has no phone at all
    const phones = resolveDialerPhones(e.lead);
    const phone = phones[0]?.formatted;
    if (!phone) {
      leadsWithoutPhone++;
      continue;
    }

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

  // Ligações de hoje por NÚMERO (story power-dialer-rounds, 05/11/2026): cada
  // número do lead tem o seu limite diário; antes era por lead.
  const leadIds = [...new Set(phoneEnrollments.map((pe) => pe.enrollment.lead_id))];
  let attemptsByPhone = new Map<string, { count: number; last: string | null }>();

  if (leadIds.length > 0) {
    // Start of TODAY in BRT (not the server's UTC midnight). `setHours(0,0,0,0)`
    // on a UTC-clock server counts the daily call limit against the wrong day
    // near midnight BRT.
    const todayStartIso = brtDayStartIso(brtTodayIso());

    const todayCalls = await chunkedIn<{ lead_id: string; destination: string | null; started_at: string | null }>(leadIds, (chunk) =>
      from(supabase, 'calls')
        .select('lead_id, destination, started_at')
        .in('lead_id', chunk)
        .gte('started_at', todayStartIso) as unknown as PromiseLike<{
        data: Array<{ lead_id: string; destination: string | null; started_at: string | null }> | null;
        error: unknown;
      }>,
    );

    attemptsByPhone = countCallsByPhone(todayCalls);
  }

  const result: DialerQueueItem[] = [];
  let leadsAtDailyLimit = 0;
  for (const { enrollment: e, stepInfo, phone, phones } of phoneEnrollments) {
    if (!e.lead || !e.cadence) continue;
    const phoneAttempts: DialerPhoneAttempt[] = phones.map((p) => {
      const a = attemptsByPhone.get(phoneKey(p.formatted));
      return { phone: p.formatted, attemptsToday: a?.count ?? 0, lastAttemptAt: a?.last ?? null };
    });
    // Sai da fila só quando TODOS os números atingiram o limite do dia.
    if (phoneAttempts.every((a) => a.attemptsToday >= dailyLimit)) {
      leadsAtDailyLimit++;
      continue;
    }

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
      phoneAttempts,
    });
  }

  const items = priorityQueueEnabled
    ? (await rankFetchedDialerQueue({ supabase, orgId, items: result, now })).slice(0, 100)
    : result;

  return {
    success: true,
    data: {
      items,
      stats: {
        leadsWithoutPhone,
        leadsAtDailyLimit,
        leadsWithSnooze: 0, // ainda não existe snooze
        totalAvailable: items.length,
      },
      priorityQueueEnabled,
    },
  };
}

type DialerEnrollmentRow = {
  id: string;
  cadence_id: string;
  lead_id: string;
  current_step: number;
  next_step_due: string;
  lead: { id: string; nome_fantasia: string | null; razao_social: string | null; cnpj: string; telefone: string | null; first_name: string | null; last_name: string | null; socios: LeadSocio[] | null; phones: LeadPhone[] | null } | null;
  cadence: { id: string; name: string; type: string | null; executor: string | null } | null;
};

async function includeSignaledDueEnrollments(args: {
  supabase: unknown;
  orgId: string;
  userId: string;
  role: string;
  existing: DialerEnrollmentRow[];
  now: Date;
  select: string;
}): Promise<DialerEnrollmentRow[]> {
  const { supabase, orgId, userId, role, existing, now, select } = args;
  const already = new Set(existing.map((row) => row.lead_id));
  const sinceReply = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const sinceNoShow = new Date(now.getTime() - 14 * 86_400_000).toISOString();

  const [interactionResult, noShowResult] = await Promise.all([
    from(supabase as never, 'interactions')
      .select('lead_id')
      .eq('org_id', orgId)
      .in('type', ['replied', 'opened', 'clicked'])
      .gte('created_at', sinceReply) as unknown as Promise<{ data: Array<{ lead_id: string | null }> | null }>,
    (role !== 'manager'
      ? from(supabase as never, 'leads').select('id').eq('assigned_to', userId).gte('meeting_no_show_at', sinceNoShow)
      : from(supabase as never, 'leads').select('id').gte('meeting_no_show_at', sinceNoShow)
    ) as unknown as Promise<{ data: Array<{ id: string }> | null }>,
  ]);

  const missing: string[] = [];
  const seenMissing = new Set<string>();
  for (const row of interactionResult.data ?? []) {
    if (!row.lead_id || already.has(row.lead_id) || seenMissing.has(row.lead_id)) continue;
    seenMissing.add(row.lead_id);
    missing.push(row.lead_id);
  }
  for (const row of noShowResult.data ?? []) {
    if (already.has(row.id) || seenMissing.has(row.id)) continue;
    seenMissing.add(row.id);
    missing.push(row.id);
  }
  if (missing.length === 0) return existing;

  let extraQuery = from(supabase as never, 'cadence_enrollments')
    .select(select)
    .eq('status', 'active')
    .lte('next_step_due', now.toISOString())
    .in('lead_id', missing.slice(0, 100));
  if (role !== 'manager') extraQuery = extraQuery.eq('lead.assigned_to', userId);
  const { data: extra } = (await extraQuery) as { data: DialerEnrollmentRow[] | null };
  if (!extra || extra.length === 0) return existing;

  const byId = new Map(existing.map((row) => [row.id, row]));
  for (const row of extra) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function rankFetchedDialerQueue(args: {
  supabase: unknown;
  orgId: string;
  items: DialerQueueItem[];
  now: Date;
}): Promise<DialerQueueItem[]> {
  const { supabase, orgId, items, now } = args;
  if (items.length === 0) return items;
  const leadIds = [...new Set(items.map((item) => item.leadId))];
  const sinceReply = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const [leadResult, interactionResult] = await Promise.all([
    from(supabase as never, 'leads')
      .select('id, updated_at, meeting_no_show_at')
      .in('id', leadIds) as unknown as Promise<{
      data: Array<{ id: string; updated_at: string; meeting_no_show_at: string | null }> | null;
    }>,
    from(supabase as never, 'interactions')
      .select('lead_id, type, created_at')
      .eq('org_id', orgId)
      .in('lead_id', leadIds)
      .in('type', ['replied', 'opened', 'clicked'])
      .gte('created_at', sinceReply) as unknown as Promise<{
      data: Array<{ lead_id: string; type: string; created_at: string }> | null;
    }>,
  ]);

  const signals = (leadResult.data ?? []).map((row) => ({
    leadId: row.id,
    noShowAt: row.meeting_no_show_at,
    updatedAt: row.updated_at,
  }));
  const interactions: NextLeadInteraction[] = (interactionResult.data ?? []).map((row) => ({
    leadId: row.lead_id,
    type: row.type,
    at: row.created_at,
  }));
  return rankDialerQueue(items, { signals, interactions, now });
}
