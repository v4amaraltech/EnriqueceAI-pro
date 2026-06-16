import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { createNotification, createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';
import { sendCloserFeedbackEmail } from '@/features/leads/actions/send-closer-feedback';

export const maxDuration = 60;

/**
 * Cron: "reunião sem desfecho" — o vigia que faltava.
 *
 * Hoje a automação de no-show só dispara pelo caminho do closer (SDR marca
 * "Ganho" → link de feedback → closer marca no_show → reabre + follow-up). Mas
 * num no-show real o SDR não marca "Ganho" (não foi ganho), então a reunião
 * passa e o lead fica em limbo: 'qualified', fora de cadência, sem atividade e
 * sem notificação (caso real: Silvana Grassi, jun/2026).
 *
 * Este cron varre `find_meetings_pending_outcome()` e age em dois estágios:
 *  - Estágio 1 (checkpoint, reunião + 24h): cria uma atividade na fila do SDR
 *    pra registrar o desfecho, manda o link de feedback ao closer (se a reunião
 *    for recente) e notifica o SDR.
 *  - Estágio 2 (escalação, checkpoint + 2 dias úteis sem desfecho): garante um
 *    follow-up de telefone na fila e escala ao gestor.
 *
 * Idempotência: o estágio é decidido pelos fatos da RPC (checkpoint_at,
 * escalated, has_pending_activity, has_open_feedback) + marcadores de
 * interaction (`meeting_outcome_checkpoint` / `meeting_outcome_escalated`), de
 * modo que reexecuções não duplicam.
 */

const CHECKPOINT_GRACE_HOURS = 24;
const ESCALATE_BUSINESS_DAYS = 2;
// Reunião mais velha que isto: não vale pedir feedback ao closer (não lembra).
// Ainda criamos a atividade do SDR e notificamos — só pulamos o link do closer.
const STALE_FOR_CLOSER_DAYS = 10;
// Teto por execução pra não disparar uma rajada de e-mails/notificações quando
// houver acúmulo histórico (na 1ª execução há ~20 leads antigos em limbo).
const MAX_PER_RUN = 50;

interface PendingOutcomeRow {
  lead_id: string;
  org_id: string;
  closer_id: string | null;
  assigned_to: string | null;
  won_by: string | null;
  meeting_end: string;
  checkpoint_at: string | null;
  escalated: boolean;
  has_pending_activity: boolean;
  has_open_feedback: boolean;
}

type Stage = 'stage1' | 'stage2';

/** Next business day (Mon–Fri) at 09:00 BRT, as a UTC ISO string. */
export function nextBusinessDayAt9hBRT(now: Date): string {
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const d = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate() + 1));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0)).toISOString();
}

/** `from` + N business days (skips Sat/Sun), preserving the time-of-day. */
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

/**
 * Decide which stage (if any) applies to a candidate row at `now`.
 * Pure — unit-tested in route.test.ts.
 */
export function classifyStage(row: PendingOutcomeRow, now: Date): Stage | null {
  const meetingEnd = new Date(row.meeting_end);
  if (Number.isNaN(meetingEnd.getTime())) return null;

  if (!row.checkpoint_at) {
    // Não checkpointar se o SDR já tem atividade pendente — não está em limbo.
    if (row.has_pending_activity) return null;
    const fireAt = new Date(meetingEnd.getTime() + CHECKPOINT_GRACE_HOURS * 60 * 60 * 1000);
    return fireAt <= now ? 'stage1' : null;
  }

  // Checkpoint já criado: escala uma única vez, após 2 dias úteis sem desfecho.
  if (row.escalated) return null;
  const checkpointAt = new Date(row.checkpoint_at);
  if (Number.isNaN(checkpointAt.getTime())) return null;
  return addBusinessDays(checkpointAt, ESCALATE_BUSINESS_DAYS) <= now ? 'stage2' : null;
}

interface LeadInfo {
  id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  first_name: string | null;
  last_name: string | null;
}

interface CloserInfo {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

function leadDisplayName(l: LeadInfo | undefined): string {
  if (!l) return 'Lead';
  return (
    l.nome_fantasia
    ?? l.razao_social
    ?? ([l.first_name, l.last_name].filter(Boolean).join(' ').trim() || 'Lead')
  );
}

async function runMeetingOutcomeCheck() {
  const supabase = createServiceRoleClient();
  const now = new Date();

  const { data: rows, error } = (await (supabase.rpc as unknown as (
    fn: string,
  ) => Promise<{ data: PendingOutcomeRow[] | null; error: { message: string } | null }>)(
    'find_meetings_pending_outcome',
  )) as { data: PendingOutcomeRow[] | null; error: { message: string } | null };

  if (error) {
    console.error('[meeting-outcome-check] RPC error:', error.message);
    throw new Error(error.message);
  }
  if (!rows?.length) {
    return { candidates: 0, checkpoints: 0, escalations: 0, skipped: 0 };
  }

  // Resolve stages first so we can batch-fetch only what we need.
  const staged = rows
    .map((row) => ({ row, stage: classifyStage(row, now) }))
    .filter((s): s is { row: PendingOutcomeRow; stage: Stage } => s.stage !== null);

  const stage1 = staged.filter((s) => s.stage === 'stage1').slice(0, MAX_PER_RUN);
  const stage2 = staged.filter((s) => s.stage === 'stage2').slice(0, MAX_PER_RUN);

  if (!stage1.length && !stage2.length) {
    return { candidates: rows.length, checkpoints: 0, escalations: 0, skipped: rows.length };
  }

  // Batch-fetch lead + closer info for everything we'll touch.
  const leadIds = [...new Set([...stage1, ...stage2].map((s) => s.row.lead_id))];
  const closerIds = [
    ...new Set(stage1.map((s) => s.row.closer_id).filter((c): c is string => !!c)),
  ];

  const [leadsResult, closersResult] = await Promise.all([
    from(supabase, 'leads')
      .select('id, nome_fantasia, razao_social, first_name, last_name')
      .in('id', leadIds)
      .is('deleted_at', null) as Promise<{ data: LeadInfo[] | null }>,
    closerIds.length
      ? (from(supabase, 'closers').select('id, name, email, phone').in('id', closerIds) as Promise<{ data: CloserInfo[] | null }>)
      : Promise.resolve({ data: [] as CloserInfo[] }),
  ]);

  const leadMap = new Map((leadsResult.data ?? []).map((l) => [l.id, l]));
  const closerMap = new Map((closersResult.data ?? []).map((c) => [c.id, c]));

  let checkpoints = 0;
  let escalations = 0;

  for (const { row } of stage1) {
    try {
      await handleCheckpoint(supabase, row, leadMap.get(row.lead_id), row.closer_id ? closerMap.get(row.closer_id) : undefined, now);
      checkpoints++;
    } catch (err) {
      console.error('[meeting-outcome-check] checkpoint failed for lead=%s:', row.lead_id, err);
    }
  }

  for (const { row } of stage2) {
    try {
      await handleEscalation(supabase, row, leadMap.get(row.lead_id), now);
      escalations++;
    } catch (err) {
      console.error('[meeting-outcome-check] escalation failed for lead=%s:', row.lead_id, err);
    }
  }

  return {
    candidates: rows.length,
    checkpoints,
    escalations,
    skipped: rows.length - checkpoints - escalations,
  };
}

/**
 * Estágio 1 — checkpoint. Cria a atividade de "registrar desfecho" na fila do
 * SDR, manda o link de feedback ao closer (se a reunião for recente) e notifica
 * o SDR. Grava o marcador `meeting_outcome_checkpoint` na timeline.
 */
async function handleCheckpoint(
  supabase: ReturnType<typeof createServiceRoleClient>,
  row: PendingOutcomeRow,
  lead: LeadInfo | undefined,
  closer: CloserInfo | undefined,
  now: Date,
) {
  const sdrUserId = row.won_by ?? row.assigned_to;
  if (!sdrUserId) return; // sem dono não há a quem atribuir/notificar
  const leadName = leadDisplayName(lead);

  // Atividade na fila do SDR pra registrar o desfecho (ou ligar e retomar).
  await from(supabase, 'scheduled_activities').insert({
    org_id: row.org_id,
    lead_id: row.lead_id,
    user_id: sdrUserId,
    channel: 'phone',
    scheduled_at: nextBusinessDayAt9hBRT(now),
    status: 'pending',
    notes: 'Reunião sem desfecho registrado — confirme se aconteceu (marque Ganho/Perdido) ou ligue para retomar o contato.',
  } as Record<string, unknown>);

  // Pede o desfecho ao closer reaproveitando toda a máquina de feedback — mas
  // só se a reunião for recente (reunião antiga o closer não lembra) e ainda
  // não houver um link de feedback aberto.
  const meetingAgeDays = (now.getTime() - new Date(row.meeting_end).getTime()) / (24 * 60 * 60 * 1000);
  if (closer?.email && row.closer_id && !row.has_open_feedback && meetingAgeDays <= STALE_FOR_CLOSER_DAYS) {
    await sendCloserFeedbackEmail({
      leadId: row.lead_id,
      orgId: row.org_id,
      closerId: row.closer_id,
      closerName: closer.name,
      closerEmail: closer.email,
      closerPhone: closer.phone,
      leadName,
      senderUserId: sdrUserId,
    }).catch((err) => console.error('[meeting-outcome-check] closer feedback send failed:', err));
  }

  // Notifica o SDR (in-app + Realtime).
  await createNotification({
    org_id: row.org_id,
    user_id: sdrUserId,
    type: 'closer_feedback',
    title: `⏰ Reunião sem desfecho — ${leadName}`,
    body: 'A reunião já passou e ninguém registrou o desfecho. Marque Ganho/Perdido ou retome o contato pela atividade na sua fila.',
    resource_type: 'lead',
    resource_id: row.lead_id,
    metadata: { system_event: 'meeting_outcome_checkpoint' },
  }).catch((err) => console.error('[meeting-outcome-check] SDR notification failed:', err));

  // Marcador na timeline (idempotência do estágio + auditoria).
  await from(supabase, 'interactions').insert({
    org_id: row.org_id,
    lead_id: row.lead_id,
    channel: 'system',
    type: 'sent',
    message_content: 'Reunião sem desfecho — checkpoint criado (atividade na fila + feedback ao closer)',
    metadata: { system_event: 'meeting_outcome_checkpoint', auto: true, source: 'meeting_outcome_check' },
  } as Record<string, unknown>);
}

/**
 * Estágio 2 — escalação. Passados ~2 dias úteis do checkpoint sem desfecho,
 * garante um follow-up de telefone na fila (caso a atividade do estágio 1 tenha
 * sido fechada sem resolver) e escala ao gestor. Grava `meeting_outcome_escalated`.
 */
async function handleEscalation(
  supabase: ReturnType<typeof createServiceRoleClient>,
  row: PendingOutcomeRow,
  lead: LeadInfo | undefined,
  now: Date,
) {
  const sdrUserId = row.won_by ?? row.assigned_to;
  const leadName = leadDisplayName(lead);

  // Garante um follow-up de telefone se a fila estiver vazia (atividade do
  // estágio 1 concluída/cancelada sem registrar desfecho).
  if (!row.has_pending_activity && sdrUserId) {
    await from(supabase, 'scheduled_activities').insert({
      org_id: row.org_id,
      lead_id: row.lead_id,
      user_id: sdrUserId,
      channel: 'phone',
      scheduled_at: nextBusinessDayAt9hBRT(now),
      status: 'pending',
      notes: 'Reunião segue sem desfecho após alguns dias — retomar o contato e definir Ganho/Perdido.',
    } as Record<string, unknown>);
  }

  // Escala ao gestor (in-app). Uma vez só, gated pelo marcador abaixo.
  await createNotificationsForOrgMembers({
    orgId: row.org_id,
    type: 'closer_feedback',
    title: `⚠️ Reunião sem desfecho há dias — ${leadName}`,
    body: 'A reunião passou e o desfecho não foi registrado nem pelo SDR nem pelo closer. Verifique o lead.',
    resourceType: 'lead',
    resourceId: row.lead_id,
    metadata: { system_event: 'meeting_outcome_escalated' },
    roleFilter: 'manager',
  }).catch((err) => console.error('[meeting-outcome-check] manager escalation failed:', err));

  // Marcador na timeline (idempotência do estágio + auditoria).
  await from(supabase, 'interactions').insert({
    org_id: row.org_id,
    lead_id: row.lead_id,
    channel: 'system',
    type: 'sent',
    message_content: 'Reunião sem desfecho — escalado ao gestor (follow-up garantido na fila do SDR)',
    metadata: { system_event: 'meeting_outcome_escalated', auto: true, source: 'meeting_outcome_check' },
  } as Record<string, unknown>);
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runMeetingOutcomeCheck();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[meeting-outcome-check] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
