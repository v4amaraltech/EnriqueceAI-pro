'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { isUuid } from '@/lib/utils/uuid';

import type { CadenceRow, CadenceStepRow, MessageTemplateRow } from '@/features/cadences/types';
import type { EnrichmentStatus, LeadAddress, LeadEmail, LeadPhone, LeadSocio, LeadStatus } from '@/features/leads/types';

import { autoSendKey, isHandledByAutoSend } from '@/features/whatsapp-auto-send/utils/auto-step';

import { entraNaFilaHumana } from '../utils/fila-humana';
import { cadenceStepDay } from '../utils/step-day';
import { resolveWhatsAppPhone } from '../utils/resolve-whatsapp-phone';
import type { PendingActivity, ScheduledActivityKind } from '../types';

/** Lead columns the activity queue renders (ActivityLead). */
const SCHEDULED_LEAD_COLUMNS =
  'id, org_id, nome_fantasia, razao_social, cnpj, email, telefone, porte, first_name, last_name, socios, endereco, instagram, linkedin, website, status, meeting_scheduled_at, enrichment_status, notes, fit_score, engagement_score, phones, emails, job_title, lead_source, canal, segmento, assigned_to, custom_field_values, is_inbound, created_at';
/** Cadence-queue variant: also needs whatsapp_invalid_at / email_bounced_at to skip blocked steps. */
const QUEUE_LEAD_COLUMNS = `${SCHEDULED_LEAD_COLUMNS}, whatsapp_invalid_at, email_bounced_at`;

interface RawLead {
  id: string;
  org_id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string;
  email: string | null;
  telefone: string | null;
  municipio: string | null;
  uf: string | null;
  porte: string | null;
  first_name: string | null;
  last_name: string | null;
  socios: LeadSocio[] | null;
  endereco: LeadAddress | null;
  instagram: string | null;
  linkedin: string | null;
  website: string | null;
  status: LeadStatus | null;
  meeting_scheduled_at: string | null;
  enrichment_status: EnrichmentStatus | null;
  notes: string | null;
  fit_score: number | null;
  engagement_score: number | null;
  is_inbound: boolean;
  created_at: string;
  phones: LeadPhone[] | null;
  emails: LeadEmail[] | null;
  job_title: string | null;
  lead_source: string | null;
  canal: string | null;
  segmento: string | null;
  assigned_to: string | null;
  custom_field_values: Record<string, string> | null;
  whatsapp_invalid_at: string | null;
  email_bounced_at?: string | null;
  lost_at?: string | null;
  loss_notes?: string | null;
  loss_reason_id?: string | null;
}

interface EnrollmentRow {
  id: string;
  cadence_id: string;
  lead_id: string;
  current_step: number;
  status: string;
  next_step_due: string | null;
  snooze_count: number | null;
  loss_notes?: string | null;
  lead: RawLead;
  cadence: Pick<CadenceRow, 'id' | 'name' | 'total_steps' | 'created_by' | 'type'> & { executor?: string | null };
}

export async function fetchPendingActivities(
  options: { assignedTo?: string; includeLeadCard?: boolean } = {},
): Promise<ActionResult<PendingActivity[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase, userId, role } = auth.data;
  // Dono dos leads da fila: SDR sempre a própria; gestor pode pedir um SDR
  // (Cockpit) — assim o teto de 1500/100 vale para aquele SDR, não para a org.
  const ownerFilter = role !== 'manager' ? userId : isUuid(options.assignedTo) ? options.assignedTo : null;
  const includeLeadCard = options.includeLeadCard === true;
  const queueLeadColumns = includeLeadCard
    ? `${QUEUE_LEAD_COLUMNS}, lost_at, loss_notes, loss_reason_id`
    : QUEUE_LEAD_COLUMNS;
  const enrollmentLossColumn = includeLeadCard ? 'loss_notes, ' : '';

  // 1. Fetch active enrollments whose current step is actually due (next_step_due <= now()).
  // Without this filter the queue ignores the cadence's configured delay_days — every step
  // appears as soon as the previous one is executed, defeating multi-day cadence designs
  // (e.g. an SDR could "burn through" a 6-day Outbound cadence in 30 minutes the same day).
  // A fila é PESSOAL: o SDR executa apenas os leads atribuídos a ele — mesmo que
  // possa VER outros (lead_visibility_mode). Managers veem a org inteira. Filtrar
  // por posse aqui, e não confiar só no RLS de leads: em modo 'all' o RLS deixa de
  // escopar por assigned_to e o SDR herdaria a fila de todos os SDRs.
  // Cap defensivo da fila. Ordena por next_step_due ASC (mais atrasado primeiro):
  // se o teto for atingido, o que sobra é o MAIS urgente — não uma fatia
  // arbitrária por data de inscrição. O `enrolled_at desc` + limit(500) antigo
  // fazia SDR de backlog alto (ex.: 498 due, a 2 do teto) perder cadências
  // vencidas SILENCIOSAMENTE ao cruzar 500. 1500 dá folga p/ a org inteira do
  // manager; o warn abaixo denuncia se algum dia encostar.
  const QUEUE_ENROLLMENT_LIMIT = 1500;
  let enrollQuery = from(supabase, 'cadence_enrollments')
    // Only the lead columns the queue uses (ActivityLead + whatsapp_invalid_at for
    // the WhatsApp skip below) — `*` shipped every column of up to ~1.500 leads.
    .select(`id, cadence_id, lead_id, current_step, status, next_step_due, snooze_count, ${enrollmentLossColumn}lead:leads!inner(${queueLeadColumns}), cadence:cadences(id, name, total_steps, created_by, type, executor)`)
    .eq('status', 'active')
    .not('next_step_due', 'is', null)
    .lte('next_step_due', new Date().toISOString());
  if (ownerFilter) enrollQuery = enrollQuery.eq('lead.assigned_to', ownerFilter);
  const { data: enrollments, error: enrollError } = (await enrollQuery
    .order('next_step_due', { ascending: true })
    .limit(QUEUE_ENROLLMENT_LIMIT)) as { data: EnrollmentRow[] | null; error: { message: string } | null };

  const qErr = handleQueryError(enrollError, 'Erro ao buscar atividades pendentes', 'activities');
  if (qErr) return qErr;

  // Não deixa o teto virar omissão silenciosa (o bug do limit(500) era invisível).
  if (enrollments && enrollments.length >= QUEUE_ENROLLMENT_LIMIT) {
    console.warn(
      `[activities] fila de pendências atingiu o teto de ${QUEUE_ENROLLMENT_LIMIT} enrollments (user ${userId}, role ${role}) — cadências menos urgentes podem ter sido omitidas.`,
    );
  }

  // Sem cadência vencida a fila de retornos ainda existe. Sair aqui escondia
  // o retorno avulso (gestor agenda phone no lead de um SDR sem enrollment due).
  if (!enrollments || enrollments.length === 0) {
    return mergeWithScheduledReturns(supabase, ownerFilter, []);
  }

  // 2. Collect unique cadence IDs and batch-fetch steps + templates
  const cadenceIds = [...new Set(enrollments.map((e) => e.cadence_id))];

  const { data: steps } = (await from(supabase, 'cadence_steps')
    .select('*')
    .in('cadence_id', cadenceIds)) as { data: CadenceStepRow[] | null };

  const templateIds = (steps ?? [])
    .map((s) => s.template_id)
    .filter((id): id is string => id != null);

  let templates: MessageTemplateRow[] = [];
  if (templateIds.length > 0) {
    const { data: tplData } = (await from(supabase, 'message_templates')
      .select('*')
      .in('id', templateIds)) as { data: MessageTemplateRow[] | null };
    templates = tplData ?? [];
  }

  // 3. Build lookup maps
  const stepMap = new Map<string, CadenceStepRow[]>();
  for (const s of steps ?? []) {
    const list = stepMap.get(s.cadence_id) ?? [];
    list.push(s);
    stepMap.set(s.cadence_id, list);
  }

  const templateMap = new Map<string, MessageTemplateRow>();
  for (const t of templates) {
    templateMap.set(t.id, t);
  }

  // WhatsApp automático: passos que o robô envia saem da fila do SDR. Os que
  // falharam de vez na fila automática voltam como tarefa manual.
  const autoCadenceIds = [
    ...new Set((steps ?? []).filter((s) => s.channel === 'whatsapp' && s.auto_send).map((s) => s.cadence_id)),
  ];
  const autoSendFailedKeys = new Set<string>();
  if (autoCadenceIds.length > 0) {
    const { data: failedItems } = (await from(supabase, 'whatsapp_send_queue' as never)
      .select('enrollment_id, step_id')
      .eq('status', 'failed')
      .in('cadence_id', autoCadenceIds)) as { data: Array<{ enrollment_id: string; step_id: string }> | null };
    for (const f of failedItems ?? []) autoSendFailedKeys.add(autoSendKey(f.enrollment_id, f.step_id));
  }

  // 4. Build candidate activities (before filtering executed ones)
  // For each enrollment, generate activities for ALL steps within 24h cumulative delay
  interface CandidateActivity {
    activity: PendingActivity;
    cadenceId: string;
    stepId: string;
    leadId: string;
  }
  const candidates: CandidateActivity[] = [];

  for (const enrollment of enrollments) {
    if (!enrollment.lead || !enrollment.cadence || !enrollment.next_step_due) continue;

    // Fora da fila humana: auto_email (job em background) e cadências executadas pela IA (Ana)
    if (!entraNaFilaHumana(enrollment.cadence)) continue;

    const cadenceSteps = (stepMap.get(enrollment.cadence_id) ?? [])
      .slice()
      .sort((a, b) => a.step_order - b.step_order);

    const currentStepOrder = enrollment.current_step;

    const leadData = toQueueLead(enrollment.lead, includeLeadCard, enrollment.loss_notes);

    let cumulativeHours = 0;

    for (const step of cadenceSteps) {
      if (step.step_order < currentStepOrder) continue;

      // Accumulate delay for steps beyond the current one
      if (step.step_order > currentStepOrder) {
        cumulativeHours += step.delay_days * 24 + step.delay_hours;
      }

      // Stop if cumulative delay exceeds 24h
      if (cumulativeHours > 24) break;

      // Suppress WhatsApp steps when the lead's number was flagged as not WhatsApp
      // (SDR feedback via "Não é WhatsApp" button)
      if (step.channel === 'whatsapp' && enrollment.lead.whatsapp_invalid_at) continue;

      // WhatsApp automático: o robô envia pela fila do número do SDR (story whatsapp-evolution-paced-sending).
      if (isHandledByAutoSend(step, enrollment.lead, enrollment.id, autoSendFailedKeys)) continue;

      // E-mail com bounce: o passo de e-mail não tem como ser feito. O motor
      // (`skipEmailStepsForBouncedLeads`) avança a inscrição; até lá, some da fila.
      if (step.channel === 'email' && enrollment.lead.email_bounced_at) continue;

      // Ligação via WhatsApp (passo phone com call_provider='whatsapp', Epic 7): só
      // é executável quando o lead tem número WhatsApp resolvível e não foi marcado
      // como inválido — caso contrário some da fila (não dá pra discar).
      if (step.channel === 'phone' && step.call_provider === 'whatsapp') {
        if (enrollment.lead.whatsapp_invalid_at) continue;
        if (!resolveWhatsAppPhone(leadData)) continue;
      }

      const isCurrentStep = step.step_order === currentStepOrder;
      const template = step.template_id ? templateMap.get(step.template_id) : null;

      // Calculate actual due date for future steps based on cumulative delay
      let stepDueDate = enrollment.next_step_due;
      if (!isCurrentStep && enrollment.next_step_due) {
        const baseDue = new Date(enrollment.next_step_due);
        baseDue.setHours(baseDue.getHours() + cumulativeHours);
        stepDueDate = baseDue.toISOString();
      }

      candidates.push({
        cadenceId: enrollment.cadence_id,
        stepId: step.id,
        leadId: enrollment.lead_id,
        activity: {
          enrollmentId: enrollment.id,
          cadenceId: enrollment.cadence_id,
          cadenceName: enrollment.cadence.name,
          cadenceCreatedBy: enrollment.cadence.created_by,
          stepId: step.id,
          stepOrder: step.step_order,
          stepDay: cadenceStepDay(cadenceSteps, step.step_order),
          totalSteps: enrollment.cadence.total_steps,
          channel: step.channel,
          templateId: step.template_id,
          templateSubject: template?.subject ?? null,
          templateBody: template?.body ?? null,
          aiPersonalization: step.ai_personalization,
          nextStepDue: stepDueDate,
          isCurrentStep,
          lead: leadData,
          activityName: step.activity_name ?? null,
          callScript: step.instructions ?? null,
          callProvider: step.call_provider ?? null,
          snoozeCount: isCurrentStep ? (enrollment.snooze_count ?? 0) : 0,
        },
      });
    }
  }

  // Passos de cadência zerados (passo inexistente, fila da IA, WhatsApp sem
  // número) não podem engolir o retorno pendente do mesmo SDR.
  if (candidates.length === 0) {
    return mergeWithScheduledReturns(supabase, ownerFilter, [], includeLeadCard);
  }

  // 5. Filter out activities already executed (using optimized SQL function with composite index)
  const stepIds = [...new Set(candidates.map((c) => c.stepId))];
  const leadIds = [...new Set(candidates.map((c) => c.leadId))];

  const { data: executedSteps } = await (supabase.rpc as any)('get_executed_steps', {
    p_cadence_ids: cadenceIds,
    p_step_ids: stepIds,
    p_lead_ids: leadIds,
  }) as { data: { cadence_id: string; step_id: string; lead_id: string }[] | null };

  const executedSet = new Set(
    (executedSteps ?? []).map((i) => `${i.cadence_id}:${i.step_id}:${i.lead_id}`),
  );

  const cadenceActivities = candidates
    .filter((c) => !executedSet.has(`${c.cadenceId}:${c.stepId}:${c.leadId}`))
    .map((c) => c.activity);

  return mergeWithScheduledReturns(supabase, ownerFilter, cadenceActivities, includeLeadCard);
}

function toQueueLead(lead: RawLead, includeLeadCard: boolean, enrollmentLossNotes?: string | null) {
  const base = {
    ...lead,
    municipio: (lead.endereco as Record<string, string> | null)?.municipio ?? null,
    uf: (lead.endereco as Record<string, string> | null)?.uf ?? null,
    primeiro_nome: lead.first_name
      ?? lead.socios?.[0]?.nome?.trim().split(/\s+/)[0]
      ?? null,
  };
  if (!includeLeadCard) return base;
  return {
    ...base,
    lost_at: lead.lost_at ?? null,
    loss_notes: lead.loss_notes ?? null,
    loss_reason_id: lead.loss_reason_id ?? null,
    loss_reason_name: null,
    enrollment_loss_notes: enrollmentLossNotes ?? null,
  };
}

async function attachLossReasonNames(supabase: SupabaseClient, activities: PendingActivity[]) {
  const ids = [...new Set(activities.map((activity) => activity.lead.loss_reason_id).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  try {
    const { data, error } = (await from(supabase, 'loss_reasons')
      .select('id, name')
      .in('id', ids)) as { data: Array<{ id: string; name: string }> | null; error: { message: string } | null };
    if (error || !data) return;
    const names = new Map(data.map((row) => [row.id, row.name]));
    for (const activity of activities) {
      const id = activity.lead.loss_reason_id;
      if (id) activity.lead.loss_reason_name = names.get(id) ?? null;
    }
  } catch (err) {
    console.error('[activities] loss_reasons query error:', err);
  }
}

/** Última interação só entra com o cartão. Erro de leitura não esvazia a fila. */
async function attachLastInteractionAt(supabase: SupabaseClient, activities: PendingActivity[]) {
  const ids = [...new Set(activities.map((activity) => activity.lead.id).filter((id) => isUuid(id)))];
  if (ids.length === 0) return;
  try {
    const { data, error } = (await from(supabase, 'interactions')
      .select('lead_id, created_at')
      .in('lead_id', ids)
      .order('created_at', { ascending: false })
      .limit(1000)) as { data: Array<{ lead_id: string; created_at: string }> | null; error: { message: string } | null };
    if (error || !data) return;
    const latest = new Map<string, string>();
    for (const row of data) {
      if (row.lead_id && row.created_at && !latest.has(row.lead_id)) latest.set(row.lead_id, row.created_at);
    }
    for (const activity of activities) {
      activity.lead.last_interaction_at = latest.get(activity.lead.id) ?? null;
    }
  } catch (err) {
    console.error('[activities] interactions query error:', err);
  }
}

/**
 * Retornos avulsos (`scheduled_activities` pending) entram na fila mesmo sem
 * passo de cadência. A posse é `leads.assigned_to` (SDR da carteira), nunca
 * `scheduled_activities.user_id` (quem clicou em Agendar).
 */
async function mergeWithScheduledReturns(
  supabase: SupabaseClient,
  ownerFilter: string | null,
  cadenceActivities: PendingActivity[],
  includeLeadCard = false,
): Promise<ActionResult<PendingActivity[]>> {
  const scheduledLeadColumns = includeLeadCard
    ? `${SCHEDULED_LEAD_COLUMNS}, lost_at, loss_notes, loss_reason_id`
    : SCHEDULED_LEAD_COLUMNS;
  let scheduledQuery = from(supabase, 'scheduled_activities')
    .select(`id, lead_id, channel, call_provider, kind, scheduled_at, notes, leads!inner(${scheduledLeadColumns})`)
    .eq('status', 'pending');
  if (ownerFilter) scheduledQuery = scheduledQuery.eq('leads.assigned_to', ownerFilter);
  const scheduledResult = (await scheduledQuery
    .order('scheduled_at', { ascending: true })
    .limit(100)) as { data: Array<{
      id: string;
      lead_id: string;
      channel: string;
      call_provider: string | null;
      kind: ScheduledActivityKind | null;
      scheduled_at: string;
      notes: string | null;
      leads: RawLead;
    }> | null; error: { message: string } | null };

  if (scheduledResult.error) {
    console.error('[activities] scheduled_activities query error:', scheduledResult.error.message);
  }
  const scheduledRows = scheduledResult.data;

  const scheduledActivities: PendingActivity[] = (scheduledRows ?? []).map((row) => {
    const isLimbo = row.kind === 'limbo_followup';
    const isAntiNoShow = row.kind === 'anti_no_show';
    return {
      enrollmentId: `scheduled:${row.id}`,
      cadenceId: '',
      cadenceName: isLimbo ? 'Definir destino' : isAntiNoShow ? 'Anti no-show' : 'Atividade Agendada',
      cadenceCreatedBy: null,
      stepId: row.id,
      stepOrder: 1,
      totalSteps: 1,
      channel: row.channel as PendingActivity['channel'],
      templateId: null,
      templateSubject: null,
      templateBody: null,
      aiPersonalization: false,
      nextStepDue: row.scheduled_at,
      isCurrentStep: true,
      snoozeCount: 0,
      lead: toQueueLead(row.leads, includeLeadCard),
      activityName: isLimbo
        ? (row.notes ?? 'Definir destino')
        : isAntiNoShow
          ? (row.notes ?? 'Anti no-show')
          : row.notes ? `Retorno: ${row.notes}` : 'Retorno agendado',
      callScript: row.notes,
      callProvider: (row.call_provider ?? null) as PendingActivity['callProvider'],
      scheduledKind: isLimbo ? 'limbo_followup' : isAntiNoShow ? 'anti_no_show' : 'return',
    };
  });

  const allActivities = [...cadenceActivities, ...scheduledActivities];
  if (includeLeadCard) {
    await attachLossReasonNames(supabase, allActivities);
    await attachLastInteractionAt(supabase, allActivities);
  }

  const leadEarliestDue = new Map<string, number>();
  for (const a of allActivities) {
    const due = new Date(a.nextStepDue).getTime();
    const current = leadEarliestDue.get(a.lead.id);
    if (current === undefined || due < current) {
      leadEarliestDue.set(a.lead.id, due);
    }
  }

  const activities = allActivities.sort((a, b) => {
    const aInbound = a.lead.is_inbound ? 1 : 0;
    const bInbound = b.lead.is_inbound ? 1 : 0;
    if (aInbound !== bInbound) return bInbound - aInbound;

    if (a.lead.id !== b.lead.id) {
      const aDue = leadEarliestDue.get(a.lead.id) ?? 0;
      const bDue = leadEarliestDue.get(b.lead.id) ?? 0;
      return aDue - bDue;
    }
    if (a.isCurrentStep !== b.isCurrentStep) return a.isCurrentStep ? -1 : 1;
    return a.stepOrder - b.stepOrder;
  });

  return { success: true, data: activities };
}
