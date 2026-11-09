import type { SupabaseClient } from '@supabase/supabase-js';

import { buildLeadTemplateVariables } from '@/features/cadences/utils/build-template-variables';
import { renderTemplate } from '@/features/cadences/utils/render-template';
import { createNotification, createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';
import { from } from '@/lib/supabase/from';

import {
  maySend,
  meetingInstantFromInput,
  pickGmailAccount,
  pickWhatsAppAccount,
  planSteps,
  type AntiNoShowChannel,
  type AntiNoShowPhase,
  type EnrollmentSnap,
  type PlanDecision,
  type RunSnap,
  type StepDef,
} from './anti-no-show.logic';
import { isAntiNoShowEnabled } from './flag';

type Db = SupabaseClient;
type QueryError = { message: string; code?: string } | null;

export interface CloseProspectingInput {
  orgId: string;
  leadId: string;
  userId: string | null;
  eventId: string | null;
  source: 'sdr' | 'bdr';
}

export interface CloseProspectingResult {
  ok: boolean;
  error?: string;
}

export interface MeetingCycleInput {
  orgId: string;
  leadId: string;
  userId: string | null;
  source: 'sdr' | 'bdr';
  eventId?: string | null;
  /** Horário gravado na reunião. Sem fuso, vale como horário de Brasília. */
  startTime?: string | null;
}

export interface AntiNoShowDeps {
  now?: () => Date;
  sendEmail?: (args: {
    supabase: Db;
    orgId: string;
    userId: string;
    to: string;
    subject: string;
    htmlBody: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  sendWhatsApp?: (args: {
    supabase: Db;
    orgId: string;
    userId?: string;
    to: string;
    body: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  notify?: (args: { orgId: string; userId: string; title: string; body: string; leadId: string }) => Promise<void>;
  notifyManagers?: (args: { orgId: string; title: string; body: string; leadId: string }) => Promise<void>;
}

interface EnrollmentRow {
  id: string;
  org_id: string;
  lead_id: string;
  phase: AntiNoShowPhase;
  status: 'active' | 'completed';
  meeting_starts_at: string;
  context: 'inbound' | 'outbound';
  confirmed_at: string | null;
  confirmation_source: string | null;
  enrolled_at: string;
  booked_at: string;
  recovery_opened_at: string | null;
  completed_reason: string | null;
  source: string;
  sdr_user_id: string | null;
  calendar_event_id: string | null;
}

interface LeadRow {
  id: string;
  org_id: string;
  assigned_to: string | null;
  lead_source: string | null;
  meeting_starts_at: string | null;
  meeting_scheduled_at: string | null;
  status: string | null;
  email: string | null;
  telefone: string | null;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string | null;
  first_name: string | null;
  porte: string | null;
  endereco: { municipio?: string | null; uf?: string | null } | null;
}

const LEAD_COLUMNS = 'id, org_id, assigned_to, lead_source, meeting_starts_at, meeting_scheduled_at, status, email, telefone, nome_fantasia, razao_social, cnpj, first_name, porte, endereco';

function nowOf(deps?: AntiNoShowDeps): Date {
  return deps?.now?.() ?? new Date();
}

async function notifyUser(deps: AntiNoShowDeps | undefined, args: { orgId: string; userId: string; title: string; body: string; leadId: string }): Promise<void> {
  if (deps?.notify) {
    await deps.notify(args);
    return;
  }
  await createNotification({
    org_id: args.orgId,
    user_id: args.userId,
    type: 'meeting_reminder',
    title: args.title,
    body: args.body,
    resource_type: 'lead',
    resource_id: args.leadId,
  });
}

async function notifyManagers(deps: AntiNoShowDeps | undefined, args: { orgId: string; title: string; body: string; leadId: string }): Promise<void> {
  if (deps?.notifyManagers) {
    await deps.notifyManagers(args);
    return;
  }
  await createNotificationsForOrgMembers({
    orgId: args.orgId,
    type: 'meeting_reminder',
    title: args.title,
    body: args.body,
    resourceType: 'lead',
    resourceId: args.leadId,
    roleFilter: 'manager',
  });
}

/**
 * Uma função para os dois agendamentos.
 * Sempre conclui matrículas active/paused com o erro checado. Não marca o lead perdido.
 * Hold no caminho BDR continua mesmo com a flag desligada (comportamento atual).
 * Hold no SDR, cancelamento de retornos, fila de WhatsApp e timeline só com a flag ligada.
 */
export async function closeProspectingForMeeting(supabase: Db, input: CloseProspectingInput): Promise<CloseProspectingResult> {
  const nowIso = new Date().toISOString();
  const enrollmentUpdate = (await from(supabase, 'cadence_enrollments')
    .update({ status: 'completed', completed_at: nowIso } as Record<string, unknown>)
    .eq('lead_id', input.leadId)
    .in('status', ['active', 'paused'])) as { error: QueryError };
  if (enrollmentUpdate.error) return { ok: false, error: enrollmentUpdate.error.message };

  const flagOn = await isAntiNoShowEnabled(supabase, input.orgId);
  if (flagOn || input.source === 'bdr') {
    const hold = (await from(supabase, 'contact_holds')
      .upsert(
        { org_id: input.orgId, lead_id: input.leadId, tipo: 'prospeccao', origem: 'reuniao_agendada' } as Record<string, unknown>,
        { onConflict: 'lead_id,tipo', ignoreDuplicates: true },
      )) as { error: QueryError };
    if (hold.error) return { ok: false, error: hold.error.message };
  }
  if (!flagOn) return { ok: true };

  const tasks = (await from(supabase, 'scheduled_activities')
    .update({ status: 'cancelled' } as Record<string, unknown>)
    .eq('org_id', input.orgId)
    .eq('lead_id', input.leadId)
    .eq('status', 'pending')
    .eq('kind', 'return')) as { error: QueryError };
  if (tasks.error) return { ok: false, error: tasks.error.message };

  const queue = (await from(supabase, 'whatsapp_send_queue')
    .update({ status: 'canceled', reason: 'meeting_scheduled' } as Record<string, unknown>)
    .eq('org_id', input.orgId)
    .eq('lead_id', input.leadId)
    .eq('status', 'pending')) as { error: QueryError };
  if (queue.error) return { ok: false, error: queue.error.message };

  const marker: Record<string, string> = { system_event: 'prospecting_closed_meeting' };
  if (input.eventId) marker.calendar_event_id = input.eventId;
  const existing = (await from(supabase, 'interactions')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('lead_id', input.leadId)
    .contains('metadata', marker)
    .limit(1)) as { data: Array<{ id: string }> | null; error: QueryError };
  if (existing.error) return { ok: false, error: existing.error.message };
  if ((existing.data ?? []).length > 0) return { ok: true };

  const timeline = (await from(supabase, 'interactions')
    .insert({
      org_id: input.orgId,
      lead_id: input.leadId,
      channel: 'system',
      type: 'sent',
      message_content: 'prospecção encerrada por reunião',
      performed_by: input.userId,
      metadata: { ...marker, anti_no_show: true },
    } as Record<string, unknown>)) as { error: QueryError };
  if (timeline.error) return { ok: false, error: timeline.error.message };
  return { ok: true };
}

export async function onMeetingBooked(supabase: Db, input: MeetingCycleInput, deps?: AntiNoShowDeps): Promise<void> {
  if (!(await isAntiNoShowEnabled(supabase, input.orgId))) return;
  const now = nowOf(deps);
  const lead = await loadLead(supabase, input.leadId, input.orgId);
  const meeting = resolveMeetingInstant(lead?.meeting_starts_at, input.startTime);
  if (!lead || !meeting) return;
  const context = await resolveContext(supabase, input.orgId, lead.lead_source);
  const active = await findActive(supabase, input.leadId);
  if (active?.phase === 'recovery') {
    await completeEnrollment(supabase, active, 'superseded');
    const created = await insertEnrollment(supabase, freshRow(input, lead, meeting, context, 'pre_meeting', now));
    await writeEvent(supabase, input, 'Cadência anti no-show reiniciada depois da remarcação. A recuperação foi encerrada.');
    if (created) await deliverEnrollment(supabase, created.id, deps);
    return;
  }
  if (active?.phase === 'pre_meeting') {
    const sameInstant = Math.abs(new Date(active.meeting_starts_at).getTime() - meeting.getTime()) < 60_000;
    if (sameInstant) return;
    await rescheduleEnrollment(supabase, active, meeting, input.eventId ?? null, now);
    await writeEvent(supabase, input, 'Reunião remarcada. A cadência anti no-show foi recalculada e a confirmação foi zerada.');
    await deliverEnrollment(supabase, active.id, deps);
    return;
  }
  const created = await insertEnrollment(supabase, freshRow(input, lead, meeting, context, 'pre_meeting', now));
  if (!created) return;
  await writeEvent(supabase, input, 'Cadência anti no-show iniciada.');
  await deliverEnrollment(supabase, created.id, deps);
}

export async function onMeetingRescheduled(supabase: Db, input: MeetingCycleInput, deps?: AntiNoShowDeps): Promise<void> {
  if (!(await isAntiNoShowEnabled(supabase, input.orgId))) return;
  const now = nowOf(deps);
  const lead = await loadLead(supabase, input.leadId, input.orgId);
  const meeting = resolveMeetingInstant(lead?.meeting_starts_at, input.startTime);
  if (!meeting) return;
  const active = await findActive(supabase, input.leadId);
  if (!active) {
    await onMeetingBooked(supabase, input, deps);
    return;
  }
  if (active.phase === 'recovery') {
    await completeEnrollment(supabase, active, 'superseded');
    const context = active.context;
    const created = await insertEnrollment(supabase, {
      ...freshRow(input, lead, meeting, context, 'pre_meeting', now),
      sdr_user_id: active.sdr_user_id ?? lead?.assigned_to ?? input.userId,
    });
    await writeEvent(supabase, input, 'Reunião remarcada durante a recuperação. A recuperação foi encerrada e a cadência voltou para antes da reunião.');
    if (created) await deliverEnrollment(supabase, created.id, deps);
    return;
  }
  const sameInstant = Math.abs(new Date(active.meeting_starts_at).getTime() - meeting.getTime()) < 60_000;
  if (sameInstant) return;
  await rescheduleEnrollment(supabase, active, meeting, input.eventId ?? active.calendar_event_id, now);
  await writeEvent(supabase, input, 'Reunião remarcada. A cadência anti no-show foi recalculada e a confirmação foi zerada.');
  await deliverEnrollment(supabase, active.id, deps);
}

export async function onMeetingEnded(
  supabase: Db,
  input: { orgId: string; leadId: string; userId: string | null; reason: 'held' | 'cancelled' | 'won' | 'disqualified' },
): Promise<void> {
  if (!(await isAntiNoShowEnabled(supabase, input.orgId))) return;
  const active = await findActive(supabase, input.leadId);
  if (!active) return;
  await completeEnrollment(supabase, active, input.reason);
  const labels: Record<typeof input.reason, string> = {
    held: 'Reunião realizada. A cadência anti no-show foi encerrada e os passos pendentes foram cancelados.',
    cancelled: 'Reunião cancelada. A cadência anti no-show foi encerrada e os passos pendentes foram cancelados.',
    won: 'Lead marcado como ganho. A cadência anti no-show foi encerrada.',
    disqualified: 'Lead desqualificado. A cadência anti no-show foi encerrada.',
  };
  await writeEvent(supabase, { ...input, source: 'sdr' }, labels[input.reason]);
}

/** Abre a recuperação e devolve true quando a flag está ligada. O chamador não cria a tarefa solta. */
export async function onMeetingNoShow(
  supabase: Db,
  input: { orgId: string; leadId: string; userId: string | null; source: 'sdr' | 'bdr' },
  deps?: AntiNoShowDeps,
): Promise<boolean> {
  if (!(await isAntiNoShowEnabled(supabase, input.orgId))) return false;
  const active = await findActive(supabase, input.leadId);
  if (active?.phase === 'recovery') return true;
  const now = nowOf(deps);
  const lead = await loadLead(supabase, input.leadId, input.orgId);
  const meeting = active
    ? new Date(active.meeting_starts_at)
    : resolveMeetingInstant(lead?.meeting_starts_at, null);
  if (!meeting) return false;
  if (active) await completeEnrollment(supabase, active, 'no_show');
  const openedAt = now.toISOString();
  const created = await insertEnrollment(supabase, {
    org_id: input.orgId,
    lead_id: input.leadId,
    phase: 'recovery',
    status: 'active',
    meeting_starts_at: meeting.toISOString(),
    context: active?.context ?? (await resolveContext(supabase, input.orgId, lead?.lead_source ?? null)),
    confirmed_at: null,
    confirmation_source: null,
    enrolled_at: openedAt,
    booked_at: active?.booked_at ?? openedAt,
    recovery_opened_at: openedAt,
    source: input.source,
    sdr_user_id: active?.sdr_user_id ?? lead?.assigned_to ?? input.userId,
    calendar_event_id: active?.calendar_event_id ?? null,
  });
  await writeEvent(
    supabase,
    input,
    'Recuperação de no-show iniciada. Os próximos contatos são tarefas do SDR. O lead não foi marcado como perdido.',
  );
  if (created) await deliverEnrollment(supabase, created.id, deps);
  return true;
}

export async function markAntiNoShowConfirmed(
  supabase: Db,
  input: { orgId: string; leadId: string; source: string },
): Promise<void> {
  if (!(await isAntiNoShowEnabled(supabase, input.orgId))) return;
  const active = await findActive(supabase, input.leadId);
  if (!active || active.phase !== 'pre_meeting' || active.confirmed_at) return;
  const updated = (await from(supabase, 'anti_no_show_enrollments')
    .update({ confirmed_at: new Date().toISOString(), confirmation_source: input.source } as Record<string, unknown>)
    .eq('id', active.id)
    .eq('status', 'active')) as { error: QueryError };
  if (updated.error) throw new Error(updated.error.message);
}

/** Tick do cron já existente. Lança se a leitura falhar, para o chamador não suprimir a régua antiga. */
export async function runAntiNoShowTick(supabase: Db, orgs: 'all' | string[], deps?: AntiNoShowDeps): Promise<void> {
  await backfillFutureMeetings(supabase, orgs, deps);
  let query = from(supabase, 'anti_no_show_enrollments')
    .select('id')
    .eq('status', 'active')
    .order('meeting_starts_at', { ascending: true })
    .limit(100);
  if (orgs !== 'all') query = query.in('org_id', orgs);
  const listed = (await query) as { data: Array<{ id: string }> | null; error: QueryError };
  if (listed.error) throw new Error(`anti_no_show_enrollments: ${listed.error.message}`);
  for (const row of listed.data ?? []) {
    await deliverEnrollment(supabase, row.id, deps);
  }
}

async function backfillFutureMeetings(supabase: Db, orgs: 'all' | string[], deps?: AntiNoShowDeps): Promise<void> {
  const now = nowOf(deps);
  let query = from(supabase, 'leads')
    .select(LEAD_COLUMNS)
    .gt('meeting_starts_at', now.toISOString())
    .is('meeting_held_at', null)
    .is('meeting_no_show_at', null)
    .limit(100);
  if (orgs !== 'all') query = query.in('org_id', orgs);
  const listed = (await query) as { data: LeadRow[] | null; error: QueryError };
  if (listed.error) throw new Error(`backfill leads: ${listed.error.message}`);
  for (const lead of listed.data ?? []) {
    if (!lead.meeting_starts_at) continue;
    if (lead.status === 'unqualified' || lead.status === 'lost' || lead.status === 'won') continue;
    const active = await findActive(supabase, lead.id);
    if (active) continue;
    const context = await resolveContext(supabase, lead.org_id, lead.lead_source);
    const meeting = new Date(lead.meeting_starts_at);
    const bookedAt = lead.meeting_scheduled_at ?? now.toISOString();
    const created = await insertEnrollment(supabase, {
      org_id: lead.org_id,
      lead_id: lead.id,
      phase: 'pre_meeting',
      status: 'active',
      meeting_starts_at: meeting.toISOString(),
      context,
      confirmed_at: null,
      confirmation_source: null,
      enrolled_at: now.toISOString(),
      booked_at: bookedAt,
      recovery_opened_at: null,
      source: 'backfill',
      sdr_user_id: lead.assigned_to,
      calendar_event_id: null,
    });
    if (!created) continue;
    const covered = await coveredByOldRuler(supabase, lead.org_id, lead.id, meeting.toISOString(), context);
    for (const stepKey of covered) {
      await recordRun(supabase, {
        org_id: lead.org_id,
        enrollment_id: created.id,
        step_key: stepKey,
        meeting_starts_at: meeting.toISOString(),
        status: 'skipped',
        detail: 'virada',
      });
    }
  }
}

/** Passo que a régua antiga já registrou para esta reunião não é reenviado. Sem log, a cadência nova envia. */
async function coveredByOldRuler(
  supabase: Db,
  orgId: string,
  leadId: string,
  meetingIso: string,
  context: 'inbound' | 'outbound',
): Promise<Set<string>> {
  const reminders = (await from(supabase, 'reminder_steps')
    .select('id, channel, anchor, offset_minutes, context')
    .eq('org_id', orgId)) as {
    data: Array<{ id: string; channel: string; anchor: string; offset_minutes: number; context: string }> | null;
    error: QueryError;
  };
  if (reminders.error) throw new Error(`reminder_steps: ${reminders.error.message}`);
  const logs = (await from(supabase, 'meeting_reminder_log')
    .select('reminder_step_id')
    .eq('lead_id', leadId)
    .eq('meeting_starts_at', meetingIso)) as { data: Array<{ reminder_step_id: string }> | null; error: QueryError };
  if (logs.error) throw new Error(`meeting_reminder_log: ${logs.error.message}`);
  const logged = new Set((logs.data ?? []).map((row) => row.reminder_step_id));
  const keys = new Set<string>();
  for (const step of reminders.data ?? []) {
    if (step.context !== context || !logged.has(step.id)) continue;
    const key = oldRulerStepKey(step);
    if (key) keys.add(key);
  }
  return keys;
}

function oldRulerStepKey(step: { channel: string; anchor: string; offset_minutes: number }): string | null {
  if (step.anchor === 'on_book' && step.channel === 'email') return 'confirm_email';
  if (step.anchor === 'on_book' && step.channel === 'whatsapp') return 'confirm_whatsapp';
  if (step.anchor === 'meeting' && step.offset_minutes === -1440 && step.channel === 'email') return 'eve_email';
  if (step.anchor === 'meeting' && step.offset_minutes === -1440 && step.channel === 'whatsapp') return 'eve_whatsapp';
  if (step.anchor === 'meeting' && (step.offset_minutes === -60 || step.offset_minutes === -120) && step.channel === 'email') return 'email_soon';
  if (step.anchor === 'meeting' && step.offset_minutes === -20 && step.channel === 'whatsapp') return 'whatsapp_20m';
  return null;
}

async function deliverEnrollment(supabase: Db, enrollmentId: string, deps?: AntiNoShowDeps): Promise<void> {
  const enrollment = await reloadEnrollment(supabase, enrollmentId);
  if (!enrollment || !maySend(enrollment.status)) return;
  const now = nowOf(deps);
  const [steps, runs, lead] = await Promise.all([
    loadSteps(supabase, enrollment.org_id),
    loadRuns(supabase, enrollment.id),
    loadLead(supabase, enrollment.lead_id, enrollment.org_id),
  ]);
  if (!lead) return;

  const confirmation = await findConfirmation(supabase, enrollment);
  if (confirmation && !enrollment.confirmed_at) {
    enrollment.confirmed_at = confirmation.at;
    enrollment.confirmation_source = confirmation.source;
    await from(supabase, 'anti_no_show_enrollments')
      .update({ confirmed_at: confirmation.at, confirmation_source: confirmation.source } as Record<string, unknown>)
      .eq('id', enrollment.id)
      .eq('status', 'active');
  }
  const replied = enrollment.phase === 'recovery' ? await hasReply(supabase, enrollment) : false;
  const channels = await channelReadiness(supabase, enrollment.org_id, enrollment.sdr_user_id ?? lead.assigned_to);
  const plan = planSteps({
    steps,
    enrollment: toSnap(enrollment),
    runs,
    now,
    channels: { email: channels.email, whatsapp: channels.whatsapp },
    replied,
  });

  if (plan.stopRecovery) {
    await completeEnrollment(supabase, enrollment, 'replied');
    await writeEvent(
      supabase,
      { orgId: enrollment.org_id, leadId: enrollment.lead_id, userId: enrollment.sdr_user_id, source: 'sdr' },
      'Lead respondeu durante a recuperação de no-show. A cadência parou e o lead não foi marcado como perdido.',
    );
    return;
  }

  for (const decision of plan.decisions) {
    const fresh = await reloadEnrollment(supabase, enrollment.id);
    if (!fresh || !maySend(fresh.status)) return;
    await applyDecision(supabase, fresh, lead, decision, channels, deps);
  }
}

async function applyDecision(
  supabase: Db,
  enrollment: EnrollmentRow,
  lead: LeadRow,
  decision: PlanDecision,
  channels: ReadyChannels,
  deps?: AntiNoShowDeps,
): Promise<void> {
  if (decision.action === 'wait' || (decision.action === 'skip' && !decision.persist)) return;
  if (decision.action === 'skip') {
    await recordRun(supabase, runPayload(enrollment, decision.stepKey, 'skipped', decision.reason));
    return;
  }
  if (decision.action === 'not_sent') {
    await recordRun(supabase, runPayload(enrollment, decision.stepKey, 'not_sent', decision.reason));
    await alertChannel(deps, enrollment, lead, decision.reason);
    return;
  }
  if (decision.action === 'open_task') {
    await openTask(supabase, enrollment, lead, decision, deps);
    return;
  }
  await sendAuto(supabase, enrollment, lead, decision, channels, deps);
}

async function openTask(
  supabase: Db,
  enrollment: EnrollmentRow,
  lead: LeadRow,
  decision: Extract<PlanDecision, { action: 'open_task' }>,
  deps?: AntiNoShowDeps,
): Promise<void> {
  const userId = enrollment.sdr_user_id ?? lead.assigned_to;
  if (!userId) {
    await recordRun(supabase, runPayload(enrollment, decision.stepKey, 'not_sent', 'sem_responsavel'));
    await notifyManagers(deps, {
      orgId: enrollment.org_id,
      leadId: enrollment.lead_id,
      title: 'Anti no-show sem SDR',
      body: 'Há um passo da cadência anti no-show sem responsável no lead.',
    }).catch((err) => console.error('[anti-no-show] aviso ao gestor falhou', err));
    return;
  }
  const inserted = (await from(supabase, 'scheduled_activities')
    .insert({
      org_id: enrollment.org_id,
      lead_id: enrollment.lead_id,
      user_id: userId,
      channel: decision.channel,
      scheduled_at: decision.dueAt,
      status: 'pending',
      kind: 'anti_no_show',
      notes: decision.notes,
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: QueryError };
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? 'falha ao abrir tarefa anti no-show');
  await recordRun(supabase, {
    ...runPayload(enrollment, decision.stepKey, 'task_open', null),
    scheduled_activity_id: inserted.data.id,
  });
  if (!decision.completesEnrollment) return;
  await completeEnrollment(supabase, enrollment, 'recovery_exhausted', false);
  await writeEvent(
    supabase,
    { orgId: enrollment.org_id, leadId: enrollment.lead_id, userId, source: 'sdr' },
    'Recuperação de no-show encerrada sem resposta. O lead não foi marcado como perdido. Há uma tarefa para o SDR decidir.',
  );
  await notifyManagers(deps, {
    orgId: enrollment.org_id,
    leadId: enrollment.lead_id,
    title: 'Recuperação de no-show sem resposta',
    body: 'A cadência terminou sem resposta. O lead não foi marcado como perdido. O SDR tem uma tarefa para decidir o destino.',
  }).catch((err) => console.error('[anti-no-show] aviso ao gestor falhou', err));
}

async function sendAuto(
  supabase: Db,
  enrollment: EnrollmentRow,
  lead: LeadRow,
  decision: Extract<PlanDecision, { action: 'send' }>,
  channels: ReadyChannels,
  deps?: AntiNoShowDeps,
): Promise<void> {
  const fresh = await reloadEnrollment(supabase, enrollment.id);
  if (!fresh || !maySend(fresh.status)) {
    await recordRun(supabase, runPayload(enrollment, decision.stepKey, 'skipped', 'encerrada_antes_do_envio'));
    return;
  }
  const template = await loadTemplate(supabase, decision.templateId);
  if (!template?.body) {
    await recordRun(supabase, runPayload(enrollment, decision.stepKey, 'not_sent', 'sem_template'));
    await alertChannel(deps, enrollment, lead, 'sem_template');
    return;
  }
  const meetLink = await loadMeetLink(supabase, enrollment.lead_id);
  const when = new Date(enrollment.meeting_starts_at);
  const variables = {
    ...buildLeadTemplateVariables({
      nome_fantasia: lead.nome_fantasia,
      razao_social: lead.razao_social,
      cnpj: lead.cnpj ?? '',
      email: lead.email,
      telefone: lead.telefone,
      municipio: lead.endereco?.municipio ?? null,
      uf: lead.endereco?.uf ?? null,
      porte: lead.porte,
      primeiro_nome: lead.first_name,
    }),
    meet_link: meetLink ?? '',
    horario: when.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    data_reuniao: when.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
  };
  const rendered = renderTemplate(template.body, variables, { escapeHtml: decision.channel === 'email' });
  const subject = renderTemplate(template.subject ?? 'Lembrete da reunião', variables);

  if (decision.channel === 'email') {
    if (!lead.email || !channels.emailUserId) {
      await recordRun(supabase, runPayload(enrollment, decision.stepKey, 'not_sent', 'sem_email'));
      await alertChannel(deps, enrollment, lead, 'sem_email');
      return;
    }
    const result = await sendEmail(deps, {
      supabase,
      orgId: enrollment.org_id,
      userId: channels.emailUserId,
      to: lead.email,
      subject,
      htmlBody: rendered,
    });
    if (!result.ok) {
      await recordRun(supabase, runPayload(enrollment, decision.stepKey, 'failed', result.error ?? 'email_falhou'));
      return;
    }
  } else {
    if (!lead.telefone || !channels.whatsappReady) {
      await recordRun(supabase, runPayload(enrollment, decision.stepKey, 'not_sent', 'sem_telefone'));
      await alertChannel(deps, enrollment, lead, 'sem_telefone');
      return;
    }
    const text = toPlain(rendered, meetLink);
    const result = await sendWhatsApp(deps, {
      supabase,
      orgId: enrollment.org_id,
      userId: channels.whatsappUserId ?? undefined,
      to: lead.telefone,
      body: text,
    });
    if (!result.ok) {
      await recordRun(supabase, runPayload(enrollment, decision.stepKey, 'failed', result.error ?? 'whatsapp_falhou'));
      return;
    }
  }

  const timeline = (await from(supabase, 'interactions').insert({
    org_id: enrollment.org_id,
    lead_id: enrollment.lead_id,
    channel: decision.channel,
    type: 'sent',
    message_content: decision.channel === 'email' ? subject : toPlain(rendered, meetLink).slice(0, 500),
    performed_by: enrollment.sdr_user_id,
    metadata: { anti_no_show: true, step_key: decision.stepKey, enrollment_id: enrollment.id },
  } as Record<string, unknown>)) as { error: QueryError };
  if (timeline.error) console.error('[anti-no-show] histórico do envio falhou', timeline.error.message);
  await recordRun(supabase, runPayload(enrollment, decision.stepKey, 'sent', null));
}

async function sendEmail(deps: AntiNoShowDeps | undefined, args: {
  supabase: Db; orgId: string; userId: string; to: string; subject: string; htmlBody: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (deps?.sendEmail) return deps.sendEmail(args);
  const { EmailService } = await import('@/features/integrations/services/email.service');
  const res = await EmailService.sendEmail(args.userId, args.orgId, { to: args.to, subject: args.subject, htmlBody: args.htmlBody }, undefined, args.supabase);
  return { ok: res.success, error: res.error };
}

async function sendWhatsApp(deps: AntiNoShowDeps | undefined, args: {
  supabase: Db; orgId: string; userId?: string; to: string; body: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (deps?.sendWhatsApp) return deps.sendWhatsApp(args);
  const { EvolutionWhatsAppService } = await import('@/features/integrations/services/whatsapp-evolution.service');
  const res = await EvolutionWhatsAppService.sendMessage(args.orgId, { to: args.to, body: args.body }, args.supabase, args.userId);
  return { ok: res.success, error: res.error };
}

function toPlain(html: string, meetLink: string | null): string {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (meetLink && !text.includes(meetLink)) return `${text}\n${meetLink}`;
  return text;
}

async function alertChannel(deps: AntiNoShowDeps | undefined, enrollment: EnrollmentRow, lead: LeadRow, reason: string): Promise<void> {
  const userId = enrollment.sdr_user_id ?? lead.assigned_to;
  const title = reason.includes('whatsapp') || reason === 'sem_telefone'
    ? 'WhatsApp da reunião não foi enviado'
    : 'E-mail da reunião não foi enviado';
  const body = `Passo da cadência anti no-show não enviado (${reason}). A ligação de confirmação continua se o lead não confirmar por outro canal.`;
  try {
    if (userId) await notifyUser(deps, { orgId: enrollment.org_id, userId, title, body, leadId: enrollment.lead_id });
    else await notifyManagers(deps, { orgId: enrollment.org_id, title, body, leadId: enrollment.lead_id });
  } catch (err) {
    console.error('[anti-no-show] notificação de canal falhou', err);
  }
}

interface ReadyChannels {
  email: boolean;
  whatsapp: boolean;
  emailUserId: string | null;
  whatsappUserId: string | null;
  whatsappReady: boolean;
}

async function channelReadiness(supabase: Db, orgId: string, userId: string | null): Promise<ReadyChannels> {
  const userWa = userId ? await maybeOne<{ id: string; status: string; user_id: string | null }>(
    from(supabase, 'whatsapp_instances').select('id, status, user_id').eq('org_id', orgId).eq('user_id', userId).limit(1),
  ) : null;
  const orgWa = await maybeOne<{ id: string; status: string; user_id: string | null }>(
    from(supabase, 'whatsapp_instances').select('id, status, user_id').eq('org_id', orgId).is('user_id', null).eq('status', 'connected').limit(1),
  );
  const whatsapp = pickWhatsAppAccount(
    userWa ? { id: userWa.id, status: userWa.status, userId: userWa.user_id } : null,
    orgWa ? { id: orgWa.id, status: orgWa.status, userId: orgWa.user_id } : null,
  );
  const userGmail = userId ? await maybeOne<{ id: string; status: string; user_id: string | null }>(
    from(supabase, 'gmail_connections').select('id, status, user_id').eq('org_id', orgId).eq('user_id', userId).in('status', ['connected', 'error']).limit(1),
  ) : null;
  const otherGmail = (await from(supabase, 'gmail_connections')
    .select('id, status, user_id')
    .eq('org_id', orgId)
    .eq('status', 'connected')
    .limit(10)) as { data: Array<{ id: string; status: string; user_id: string | null }> | null; error: QueryError };
  if (otherGmail.error) throw new Error(otherGmail.error.message);
  const others = (otherGmail.data ?? [])
    .filter((row) => row.user_id && row.user_id !== userId)
    .map((row) => ({ id: row.id, status: row.status, userId: row.user_id }));
  const gmail = pickGmailAccount(
    userGmail ? { id: userGmail.id, status: userGmail.status, userId: userGmail.user_id } : null,
    others,
  );
  return {
    email: Boolean(gmail),
    whatsapp: Boolean(whatsapp),
    emailUserId: gmail?.userId ?? null,
    whatsappUserId: whatsapp?.userId ?? null,
    whatsappReady: Boolean(whatsapp),
  };
}

async function findConfirmation(supabase: Db, enrollment: EnrollmentRow): Promise<{ at: string; source: string } | null> {
  try {
    const byLead = (await from(supabase, 'confirmacoes_reuniao')
      .select('confirmado_at')
      .eq('lead_id', enrollment.lead_id)
      .gte('confirmado_at', enrollment.booked_at)
      .order('confirmado_at', { ascending: false })
      .limit(1)) as { data: Array<{ confirmado_at: string | null }> | null; error: QueryError };
    const at = byLead.error ? null : byLead.data?.[0]?.confirmado_at;
    if (at) return { at, source: 'confirmacoes_reuniao' };
    if (enrollment.calendar_event_id) {
      const byEvent = (await from(supabase, 'confirmacoes_reuniao')
        .select('confirmado_at')
        .eq('event_id', enrollment.calendar_event_id)
        .gte('confirmado_at', enrollment.booked_at)
        .limit(1)) as { data: Array<{ confirmado_at: string | null }> | null; error: QueryError };
      const eventAt = byEvent.error ? null : byEvent.data?.[0]?.confirmado_at;
      if (eventAt) return { at: eventAt, source: 'confirmacoes_reuniao' };
    }
  } catch {
    // A confirmação do n8n continua no n8n. Se a tabela não responder, o passo de ligação segue como não confirmado.
  }
  return null;
}

async function hasReply(supabase: Db, enrollment: EnrollmentRow): Promise<boolean> {
  const res = (await from(supabase, 'interactions')
    .select('id')
    .eq('lead_id', enrollment.lead_id)
    .eq('type', 'replied')
    .gte('created_at', enrollment.booked_at)
    .limit(1)) as { data: Array<{ id: string }> | null; error: QueryError };
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []).length > 0;
}

async function loadMeetLink(supabase: Db, leadId: string): Promise<string | null> {
  const res = (await from(supabase, 'interactions')
    .select('metadata')
    .eq('lead_id', leadId)
    .eq('type', 'meeting_scheduled')
    .order('created_at', { ascending: false })
    .limit(1)) as { data: Array<{ metadata: { meet_link?: string | null } | null }> | null; error: QueryError };
  if (res.error) return null;
  return res.data?.[0]?.metadata?.meet_link ?? null;
}

async function loadTemplate(supabase: Db, templateId: string | null): Promise<{ subject: string | null; body: string } | null> {
  if (!templateId) return null;
  return maybeOne<{ subject: string | null; body: string }>(
    from(supabase, 'message_templates').select('subject, body').eq('id', templateId).limit(1),
  );
}

async function loadSteps(supabase: Db, orgId: string): Promise<StepDef[]> {
  const res = (await from(supabase, 'anti_no_show_steps')
    .select('*')
    .eq('org_id', orgId)) as { data: Array<Record<string, unknown>> | null; error: QueryError };
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []).map(mapStep);
}

function mapStep(row: Record<string, unknown>): StepDef {
  const num = (value: unknown): number | null => (value == null ? null : Number(value));
  return {
    stepKey: String(row.step_key),
    phase: row.phase as StepDef['phase'],
    context: row.context as StepDef['context'],
    channel: row.channel as AntiNoShowChannel,
    mode: row.mode as StepDef['mode'],
    anchor: row.anchor as StepDef['anchor'],
    offsetMinutes: num(row.offset_minutes),
    businessDayOffset: num(row.business_day_offset),
    clockHour: num(row.clock_hour),
    clockMinute: num(row.clock_minute),
    active: row.active === true,
    onlyIfUnconfirmed: row.only_if_unconfirmed === true,
    skipIfBookedWithinHours: num(row.skip_if_booked_within_hours),
    minHoursBeforeMeeting: num(row.min_hours_before_meeting),
    quietHoursExempt: row.quiet_hours_exempt === true,
    notBeforeHourBrt: num(row.not_before_hour_brt),
    messageTemplateId: (row.message_template_id as string | null) ?? null,
  };
}

async function loadRuns(supabase: Db, enrollmentId: string): Promise<RunSnap[]> {
  const res = (await from(supabase, 'anti_no_show_runs')
    .select('step_key, meeting_starts_at, status')
    .eq('enrollment_id', enrollmentId)) as { data: Array<{ step_key: string; meeting_starts_at: string; status: RunSnap['status'] }> | null; error: QueryError };
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []).map((row) => ({
    stepKey: row.step_key,
    meetingStartsAt: row.meeting_starts_at,
    status: row.status,
  }));
}

function toSnap(row: EnrollmentRow): EnrollmentSnap {
  return {
    id: row.id,
    phase: row.phase,
    status: row.status,
    meetingStartsAt: new Date(row.meeting_starts_at),
    enrolledAt: new Date(row.enrolled_at),
    bookedAt: new Date(row.booked_at),
    context: row.context,
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
    recoveryOpenedAt: row.recovery_opened_at ? new Date(row.recovery_opened_at) : null,
  };
}

function freshRow(input: MeetingCycleInput, lead: LeadRow | null, meeting: Date, context: 'inbound' | 'outbound', phase: AntiNoShowPhase, now: Date): Record<string, unknown> {
  const nowIso = now.toISOString();
  return {
    org_id: input.orgId,
    lead_id: input.leadId,
    phase,
    status: 'active',
    meeting_starts_at: meeting.toISOString(),
    context,
    confirmed_at: null,
    confirmation_source: null,
    enrolled_at: nowIso,
    booked_at: nowIso,
    recovery_opened_at: null,
    source: input.source,
    sdr_user_id: lead?.assigned_to ?? input.userId,
    calendar_event_id: input.eventId ?? null,
  };
}

async function insertEnrollment(supabase: Db, payload: Record<string, unknown>): Promise<EnrollmentRow | null> {
  const res = (await from(supabase, 'anti_no_show_enrollments')
    .insert(payload)
    .select('*')
    .single()) as { data: EnrollmentRow | null; error: QueryError };
  if (res.error?.code === '23505') return findActive(supabase, String(payload.lead_id));
  if (res.error || !res.data) throw new Error(res.error?.message ?? 'falha ao abrir matrícula anti no-show');
  return res.data;
}

async function rescheduleEnrollment(supabase: Db, row: EnrollmentRow, meeting: Date, eventId: string | null, now: Date): Promise<void> {
  const updated = (await from(supabase, 'anti_no_show_enrollments')
    .update({
      meeting_starts_at: meeting.toISOString(),
      booked_at: now.toISOString(),
      confirmed_at: null,
      confirmation_source: null,
      calendar_event_id: eventId,
      phase: 'pre_meeting',
    } as Record<string, unknown>)
    .eq('id', row.id)
    .eq('status', 'active')) as { error: QueryError };
  if (updated.error) throw new Error(updated.error.message);
  await cancelAntiTasks(supabase, row.lead_id);
  await from(supabase, 'anti_no_show_runs')
    .update({ status: 'cancelled', detail: 'remarcada' } as Record<string, unknown>)
    .eq('enrollment_id', row.id)
    .eq('status', 'task_open');
}

async function completeEnrollment(supabase: Db, row: EnrollmentRow, reason: string, cancelTasks = true): Promise<void> {
  const updated = (await from(supabase, 'anti_no_show_enrollments')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_reason: reason,
    } as Record<string, unknown>)
    .eq('id', row.id)
    .eq('status', 'active')) as { error: QueryError };
  if (updated.error) throw new Error(updated.error.message);
  if (cancelTasks) await cancelAntiTasks(supabase, row.lead_id);
}

async function cancelAntiTasks(supabase: Db, leadId: string): Promise<void> {
  const res = (await from(supabase, 'scheduled_activities')
    .update({ status: 'cancelled' } as Record<string, unknown>)
    .eq('lead_id', leadId)
    .eq('kind', 'anti_no_show')
    .eq('status', 'pending')) as { error: QueryError };
  if (res.error) throw new Error(res.error.message);
}

async function findActive(supabase: Db, leadId: string): Promise<EnrollmentRow | null> {
  return maybeOne<EnrollmentRow>(
    from(supabase, 'anti_no_show_enrollments').select('*').eq('lead_id', leadId).eq('status', 'active').limit(1),
  );
}

async function reloadEnrollment(supabase: Db, id: string): Promise<EnrollmentRow | null> {
  return maybeOne<EnrollmentRow>(from(supabase, 'anti_no_show_enrollments').select('*').eq('id', id).limit(1));
}

async function loadLead(supabase: Db, leadId: string, orgId: string): Promise<LeadRow | null> {
  return maybeOne<LeadRow>(from(supabase, 'leads').select(LEAD_COLUMNS).eq('id', leadId).eq('org_id', orgId).limit(1));
}

async function resolveContext(supabase: Db, orgId: string, leadSource: string | null): Promise<'inbound' | 'outbound'> {
  if (!leadSource) return 'outbound';
  const mapped = await maybeOne<{ context: 'inbound' | 'outbound' }>(
    from(supabase, 'reminder_source_context').select('context').eq('org_id', orgId).eq('lead_source', leadSource).limit(1),
  );
  if (mapped?.context === 'inbound' || mapped?.context === 'outbound') return mapped.context;
  return leadSource.toLowerCase().includes('inbound') ? 'inbound' : 'outbound';
}

function resolveMeetingInstant(stored: string | null | undefined, startTime: string | null | undefined): Date | null {
  if (stored) {
    const parsed = new Date(stored);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return meetingInstantFromInput(startTime);
}

async function writeEvent(
  supabase: Db,
  input: { orgId: string; leadId: string; userId: string | null; source?: string },
  message: string,
): Promise<void> {
  const res = (await from(supabase, 'interactions').insert({
    org_id: input.orgId,
    lead_id: input.leadId,
    channel: 'system',
    type: 'sent',
    message_content: message,
    performed_by: input.userId,
    metadata: { system_event: 'anti_no_show', anti_no_show: true },
  } as Record<string, unknown>)) as { error: QueryError };
  if (res.error) throw new Error(res.error.message);
}

function runPayload(enrollment: EnrollmentRow, stepKey: string, status: string, detail: string | null): Record<string, unknown> {
  return {
    org_id: enrollment.org_id,
    enrollment_id: enrollment.id,
    step_key: stepKey,
    meeting_starts_at: new Date(enrollment.meeting_starts_at).toISOString(),
    status,
    detail,
  };
}

async function recordRun(supabase: Db, payload: Record<string, unknown>): Promise<void> {
  const res = (await from(supabase, 'anti_no_show_runs').insert(payload)) as { error: QueryError };
  if (res.error && res.error.code !== '23505') throw new Error(res.error.message);
}

async function maybeOne<T>(query: PromiseLike<{ data: T[] | T | null; error: QueryError }>): Promise<T | null> {
  const res = await query;
  if (res.error) throw new Error(res.error.message);
  if (Array.isArray(res.data)) return res.data[0] ?? null;
  return res.data ?? null;
}
