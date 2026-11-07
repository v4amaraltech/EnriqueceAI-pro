import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { brtDateKey } from '@/lib/utils/br-holidays';
import { toPlainText } from '@/lib/utils/html-to-plaintext';

import { getAllLeadPhones } from '@/features/activities/utils/resolve-whatsapp-phone';
import { AIService } from '@/features/ai/services/ai.service';
import { buildLeadContext } from '@/features/ai/utils/build-lead-context';
import { markLeadLostOnCadenceEnd } from '@/features/cadences/services/cadence-end-loss.service';
import { buildLeadTemplateVariables } from '@/features/cadences/utils/build-template-variables';
import { renderTemplate } from '@/features/cadences/utils/render-template';
import { WhatsAppCreditService } from '@/features/integrations/services/whatsapp-credit.service';
import { EvolutionWhatsAppService } from '@/features/integrations/services/whatsapp-evolution.service';
import { logLeadEvent } from '@/features/leads/actions/log-lead-event';
import { markLeadContacted } from '@/features/leads/actions/mark-contacted';
import { createNotification, createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

import { enqueueDueAutoSteps } from './enqueue.service';
import {
  MAX_CONSECUTIVE_FAILURES,
  MAX_ITEM_ATTEMPTS,
  MAX_UNANSWERED,
  brtDayStartIso,
  canSendNow,
  invalidRateTripped,
  isInSendWindow,
  isInvalidNumberError,
  limitAfterIncident,
  nextIntervalMs,
  stripUnresolvedVars,
  typingDelayMs,
  warmUpDailyLimit,
} from '../utils/pacing';

/** Item em 'sending' há mais que isso = execução que morreu no meio do envio. */
const STUCK_SENDING_MS = 10 * 60_000;

export interface InstanceRow {
  id: string;
  org_id: string;
  user_id: string;
  status: string;
  auto_send_daily_limit: number;
  auto_send_limit_changed_on: string | null;
  auto_send_next_at: string | null;
  auto_send_consecutive_failures: number;
  auto_send_paused_at: string | null;
}

interface QueueItemRow {
  id: string;
  org_id: string;
  sender_user_id: string;
  lead_id: string;
  enrollment_id: string;
  cadence_id: string;
  step_id: string;
  attempts: number;
}

interface LeadRow {
  id: string;
  org_id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string;
  email: string | null;
  telefone: string | null;
  porte: string | null;
  first_name: string | null;
  last_name: string | null;
  socios: Array<{ nome: string; qualificacao?: string }> | null;
  phones: unknown;
  endereco: Record<string, string> | null;
  segmento: string | null;
  assigned_to: string | null;
  whatsapp_invalid_at: string | null;
}

interface StepRow {
  id: string;
  step_order: number;
  template_id: string | null;
  template_id_b: string | null;
  ab_enabled: boolean;
  ab_distribution: number;
  ab_winner_variant: string | null;
  ai_personalization: boolean;
}

export type SenderOutcome =
  | 'sent'
  | 'attempted'
  | 'skipped'
  | 'canceled'
  | 'failed'
  | 'not_sent'
  | 'blocked'
  | 'busy'
  | 'paused'
  | 'idle';

export interface ProcessQueueResult {
  enqueued: number;
  reaped: number;
  senders: number;
  outcomes: Partial<Record<SenderOutcome, number>>;
}

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: Array<{ advanced: boolean; completed: boolean; new_step: number | null }> | null; error: { message: string } | null }>;

/**
 * Uma rodada do WhatsApp automático (cron a cada minuto, 8h–18h BRT).
 * 1. enfileira passos vencidos; 2. destrava itens presos; 3. cada número envia
 * no máximo 1 item, se o ritmo permitir.
 */
export async function processWhatsAppQueue(now: Date = new Date()): Promise<ProcessQueueResult> {
  const supabase = createServiceRoleClient();
  const result: ProcessQueueResult = { enqueued: 0, reaped: 0, senders: 0, outcomes: {} };

  const { enqueued } = await enqueueDueAutoSteps(supabase, now);
  result.enqueued = enqueued;
  result.reaped = await reapStuckSending(supabase, now);

  if (!isInSendWindow(now)) return result;

  const { data: pending } = (await from(supabase, 'whatsapp_send_queue' as never)
    .select('sender_user_id, org_id')
    .eq('status', 'pending')
    .limit(2000)) as { data: Array<{ sender_user_id: string; org_id: string }> | null };

  const senders = new Map<string, string>();
  for (const p of pending ?? []) senders.set(p.sender_user_id, p.org_id);
  result.senders = senders.size;
  if (senders.size === 0) return result;

  const { data: instances } = (await from(supabase, 'whatsapp_instances' as never)
    .select(
      'id, org_id, user_id, status, auto_send_daily_limit, auto_send_limit_changed_on, auto_send_next_at, auto_send_consecutive_failures, auto_send_paused_at',
    )
    .in('user_id', [...senders.keys()])) as { data: InstanceRow[] | null };

  const instanceByKey = new Map<string, InstanceRow>();
  for (const i of instances ?? []) instanceByKey.set(`${i.org_id}:${i.user_id}`, i);

  for (const [userId, orgId] of senders) {
    let outcome: SenderOutcome;
    try {
      outcome = await processSender(supabase, now, { userId, orgId }, instanceByKey.get(`${orgId}:${userId}`));
    } catch (err) {
      console.error(`[whatsapp-auto-send] sender=${userId} erro inesperado:`, err);
      outcome = 'failed';
    }
    result.outcomes[outcome] = (result.outcomes[outcome] ?? 0) + 1;
  }

  return result;
}

/**
 * Item que ficou em 'sending' (execução morreu no meio): NÃO reenvia — pode ter
 * saído. Vira tarefa manual e o SDR é avisado para conferir no WhatsApp.
 */
async function reapStuckSending(supabase: SupabaseClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_SENDING_MS).toISOString();
  const { data: stuck } = (await from(supabase, 'whatsapp_send_queue' as never)
    .update({ status: 'failed', reason: 'uncertain_send' } as never)
    .eq('status', 'sending')
    .lt('claimed_at', cutoff)
    .select('id, org_id, sender_user_id, lead_id')) as {
    data: Array<{ id: string; org_id: string; sender_user_id: string; lead_id: string }> | null;
  };

  for (const s of stuck ?? []) {
    await notifySafe({
      org_id: s.org_id,
      user_id: s.sender_user_id,
      type: 'integration_error',
      title: 'WhatsApp automático: confira se a mensagem saiu',
      body: 'Um envio automático foi interrompido no meio. A atividade voltou para a sua fila — confira no WhatsApp antes de enviar de novo.',
      resource_type: 'lead',
      resource_id: s.lead_id,
    });
  }
  return stuck?.length ?? 0;
}

export async function processSender(
  supabase: SupabaseClient,
  now: Date,
  sender: { userId: string; orgId: string },
  instance: InstanceRow | undefined,
): Promise<SenderOutcome> {
  // Sem número próprio: nunca envia por outro (critério 5). Os itens viram
  // tarefa manual — senão ficariam escondidos da fila para sempre.
  if (!instance) {
    const { data: moved } = (await from(supabase, 'whatsapp_send_queue' as never)
      .update({ status: 'failed', reason: 'no_instance' } as never)
      .eq('sender_user_id', sender.userId)
      .eq('status', 'pending')
      .select('id')) as { data: Array<{ id: string }> | null };
    if (moved?.length) {
      await notifySafe({
        org_id: sender.orgId,
        user_id: sender.userId,
        type: 'integration_error',
        title: 'WhatsApp automático sem número conectado',
        body: `${moved.length} mensagem(ns) automática(s) voltaram para a sua fila porque você não tem WhatsApp próprio conectado. Conecte em Configurações → Integrações.`,
        resource_type: 'integration',
      });
    }
    return 'not_sent';
  }

  if (instance.auto_send_paused_at) return 'paused';

  if (instance.status !== 'connected') {
    await tripBrake(supabase, instance, now, 'WhatsApp desconectado');
    return 'paused';
  }

  // Aquecimento (critério 9)
  const todayKey = brtDateKey(now);
  const warm = warmUpDailyLimit(
    { limit: instance.auto_send_daily_limit, changedOn: instance.auto_send_limit_changed_on },
    todayKey,
  );
  if (warm.changed) {
    await from(supabase, 'whatsapp_instances' as never)
      .update({ auto_send_daily_limit: warm.limit, auto_send_limit_changed_on: warm.changedOn } as never)
      .eq('id', instance.id);
  }

  const { data: item } = (await from(supabase, 'whatsapp_send_queue' as never)
    .select('id, org_id, sender_user_id, lead_id, enrollment_id, cadence_id, step_id, attempts')
    .eq('sender_user_id', sender.userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()) as { data: QueueItemRow | null };
  if (!item) return 'idle';

  // Lead que já respondeu no WhatsApp não é contato novo: não conta no limite.
  const leadReplied = await hasWhatsAppReply(supabase, item.lead_id);
  const sentTodayCounted = await countSentToday(supabase, sender.userId, now, true);

  const gate = canSendNow({
    now,
    pausedAt: instance.auto_send_paused_at,
    nextAt: instance.auto_send_next_at,
    sentTodayCounted,
    dailyLimit: warm.limit,
    countsTowardLimit: !leadReplied,
  });
  if (!gate.ok) return 'blocked';

  // Reserva a vez do número (trava contra duas rodadas em paralelo).
  const nowIso = now.toISOString();
  const { data: slot } = (await from(supabase, 'whatsapp_instances' as never)
    .update({ auto_send_next_at: new Date(now.getTime() + nextIntervalMs()).toISOString() } as never)
    .eq('id', instance.id)
    .is('auto_send_paused_at', null)
    .or(`auto_send_next_at.is.null,auto_send_next_at.lte."${nowIso}"`)
    .select('id')) as { data: Array<{ id: string }> | null };
  if (!slot?.length) return 'busy';

  const releaseSlot = async () => {
    await from(supabase, 'whatsapp_instances' as never)
      .update({ auto_send_next_at: instance.auto_send_next_at } as never)
      .eq('id', instance.id);
  };

  const { data: claimed } = (await from(supabase, 'whatsapp_send_queue' as never)
    .update({ status: 'sending', claimed_at: nowIso, attempts: item.attempts + 1 } as never)
    .eq('id', item.id)
    .eq('status', 'pending')
    .select('id')) as { data: Array<{ id: string }> | null };
  if (!claimed?.length) {
    await releaseSlot();
    return 'busy';
  }

  const outcome = await sendItem(supabase, now, instance, { ...item, attempts: item.attempts + 1 }, leadReplied);
  // Só envio de verdade (ou tentativa que chegou na Evolution) gasta a vez do número.
  if (outcome !== 'sent' && outcome !== 'attempted') await releaseSlot();
  return outcome;
}

async function sendItem(
  supabase: SupabaseClient,
  now: Date,
  instance: InstanceRow,
  item: QueueItemRow,
  leadReplied: boolean,
): Promise<SenderOutcome> {
  const setItem = (patch: Record<string, unknown>) =>
    from(supabase, 'whatsapp_send_queue' as never).update(patch as never).eq('id', item.id);

  const [{ data: enrollment }, { data: step }, { data: lead }] = await Promise.all([
    from(supabase, 'cadence_enrollments')
      .select('id, status, current_step, cadence:cadences(status)')
      .eq('id', item.enrollment_id)
      .maybeSingle() as unknown as Promise<{
      data: { id: string; status: string; current_step: number; cadence: { status: string } | null } | null;
    }>,
    from(supabase, 'cadence_steps')
      .select('id, step_order, template_id, template_id_b, ab_enabled, ab_distribution, ab_winner_variant, ai_personalization')
      .eq('id', item.step_id)
      .maybeSingle() as unknown as Promise<{ data: StepRow | null }>,
    from(supabase, 'leads')
      .select(
        'id, org_id, nome_fantasia, razao_social, cnpj, email, telefone, porte, first_name, last_name, socios, phones, endereco, segmento, assigned_to, whatsapp_invalid_at',
      )
      .eq('id', item.lead_id)
      .maybeSingle() as unknown as Promise<{ data: LeadRow | null }>,
  ]);

  // A inscrição andou, foi pausada/encerrada ou a cadência saiu do ar: o item perdeu a vez.
  if (
    !enrollment ||
    !step ||
    !lead ||
    enrollment.status !== 'active' ||
    enrollment.cadence?.status !== 'active' ||
    enrollment.current_step !== step.step_order
  ) {
    await setItem({ status: 'canceled', reason: 'stale' });
    return 'canceled';
  }

  // Lead trocou de dono: o item passa para a fila do número do novo SDR. Sem dono,
  // cancela — o passo volta a aparecer como tarefa manual (critério 15).
  if (lead.assigned_to !== item.sender_user_id) {
    await setItem(
      lead.assigned_to
        ? { status: 'pending', sender_user_id: lead.assigned_to, attempts: 0, reason: 'owner_changed' }
        : { status: 'canceled', reason: 'owner_removed' },
    );
    return 'canceled';
  }

  // Lead respondeu nesta cadência (critério 7).
  const { data: replied } = (await from(supabase, 'interactions')
    .select('id')
    .eq('cadence_id', item.cadence_id)
    .eq('lead_id', item.lead_id)
    .eq('type', 'replied')
    .limit(1)
    .maybeSingle()) as { data: { id: string } | null };
  if (replied) {
    await setItem({ status: 'canceled', reason: 'replied' });
    return 'canceled';
  }

  // "Não é WhatsApp": o motor já avança os passos de WhatsApp desse lead.
  if (lead.whatsapp_invalid_at) {
    await setItem({ status: 'canceled', reason: 'whatsapp_invalid' });
    return 'canceled';
  }

  // No máximo 3 mensagens sem resposta (critério 8).
  if ((await countUnanswered(supabase, item.lead_id)) >= MAX_UNANSWERED) {
    await skipStep(supabase, item, 'max_unanswered');
    return 'skipped';
  }

  const phone = getAllLeadPhones(lead as never)[0];
  if (!phone) {
    await setItem({ status: 'failed', reason: 'no_phone' });
    return 'failed';
  }

  const message = await buildMessage(supabase, item, step, lead);
  if (!message) {
    await setItem({ status: 'failed', reason: 'empty_message' });
    return 'failed';
  }

  const credit = await WhatsAppCreditService.checkAndDeductCredit(item.org_id, supabase);
  if (!credit.allowed) {
    await setItem({ status: 'pending', attempts: item.attempts - 1 });
    await tripBrake(supabase, instance, now, 'sem créditos de WhatsApp');
    return 'not_sent';
  }

  const send = await EvolutionWhatsAppService.sendFromUserInstance(supabase, {
    orgId: item.org_id,
    userId: item.sender_user_id,
    to: phone.raw,
    body: message.body,
    delayMs: typingDelayMs(), // critério 16
  });

  if (send.success) {
    await onSent(supabase, now, instance, item, message, send.messageId ?? null, !leadReplied);
    return 'sent';
  }

  if (send.code === 'disconnected' || send.code === 'no_instance' || send.code === 'not_configured') {
    await setItem({ status: 'pending', attempts: item.attempts - 1 });
    await tripBrake(supabase, instance, now, 'WhatsApp desconectado');
    return 'not_sent';
  }

  if (isInvalidNumberError(send.error)) {
    await setItem({ status: 'failed', reason: 'invalid_number' });
    await markNotWhatsApp(supabase, item);
    const { attempts, invalid } = await countAttemptsToday(supabase, item.sender_user_id, now);
    if (invalidRateTripped(attempts, invalid)) {
      await tripBrake(supabase, instance, now, 'muitos números sem WhatsApp hoje');
    }
    return 'attempted';
  }

  // Falha genérica: tenta de novo até 3 vezes; 3 falhas seguidas no número = freio.
  const failures = instance.auto_send_consecutive_failures + 1;
  await setItem(
    item.attempts >= MAX_ITEM_ATTEMPTS
      ? { status: 'failed', reason: `send_error: ${(send.error ?? '').slice(0, 200)}` }
      : { status: 'pending', reason: `retry: ${(send.error ?? '').slice(0, 200)}` },
  );
  await from(supabase, 'whatsapp_instances' as never)
    .update({ auto_send_consecutive_failures: failures } as never)
    .eq('id', instance.id);
  if (failures >= MAX_CONSECUTIVE_FAILURES) {
    await tripBrake(supabase, instance, now, `${failures} falhas seguidas de envio`);
  }
  return 'attempted';
}

interface BuiltMessage {
  body: string;
  templateId: string;
  aiGenerated: boolean;
  abVariant: 'A' | 'B' | null;
}

/** Template do passo (com A/B, como no e-mail automático) + variáveis + IA com o segmento do lead. */
async function buildMessage(
  supabase: SupabaseClient,
  item: QueueItemRow,
  step: StepRow,
  lead: LeadRow,
): Promise<BuiltMessage | null> {
  let templateId = step.template_id;
  let abVariant: 'A' | 'B' | null = null;
  if (step.ab_winner_variant) {
    abVariant = step.ab_winner_variant as 'A' | 'B';
    templateId = abVariant === 'A' ? step.template_id : step.template_id_b;
  } else if (step.ab_enabled && step.template_id_b) {
    abVariant = Math.random() * 100 < step.ab_distribution ? 'A' : 'B';
    templateId = abVariant === 'A' ? step.template_id : step.template_id_b;
  }
  if (!templateId) return null;

  const { data: template } = (await from(supabase, 'message_templates')
    .select('id, body')
    .eq('id', templateId)
    .maybeSingle()) as { data: { id: string; body: string } | null };
  if (!template?.body) return null;

  const variables: Record<string, string | null> = {
    ...buildLeadTemplateVariables(lead as never, lead.first_name ?? lead.socios?.[0]?.nome),
    nome_vendedor: null,
    email_vendedor: null,
  };
  // Quem assina é o SDR dono do número que envia.
  try {
    const { data: vendor } = await createAdminSupabaseClient().auth.admin.getUserById(item.sender_user_id);
    const meta = vendor?.user?.user_metadata as { full_name?: string } | undefined;
    variables.nome_vendedor = meta?.full_name ?? null;
    variables.email_vendedor = vendor?.user?.email ?? null;
  } catch (err) {
    console.error(`[whatsapp-auto-send] item=${item.id} falha ao buscar o SDR:`, err);
  }

  const rendered = renderTemplate(template.body, variables);
  let body = stripUnresolvedVars(/<[a-z][\s\S]*>/i.test(rendered) ? toPlainText(rendered) : rendered);
  let aiGenerated = false;

  if (step.ai_personalization && body) {
    try {
      const ai = await AIService.personalizeMessage(
        'whatsapp',
        body,
        buildLeadContext({
          ...lead,
          municipio: lead.endereco?.municipio ?? null,
          uf: lead.endereco?.uf ?? null,
        }),
        item.org_id,
      );
      if (ai.body?.trim()) {
        body = ai.body.trim();
        aiGenerated = true;
      }
    } catch (err) {
      // Fallback: segue com o template.
      console.error(`[whatsapp-auto-send] item=${item.id} personalização da IA falhou, usando o template:`, err);
    }
  }

  if (!body) return null;
  return { body, templateId: template.id, aiGenerated, abVariant };
}

async function onSent(
  supabase: SupabaseClient,
  now: Date,
  instance: InstanceRow,
  item: QueueItemRow,
  message: BuiltMessage,
  externalId: string | null,
  countsTowardLimit: boolean,
): Promise<void> {
  await from(supabase, 'whatsapp_send_queue' as never)
    .update({
      status: 'sent',
      reason: null,
      sent_at: now.toISOString(),
      external_id: externalId,
      counts_toward_limit: countsTowardLimit,
    } as never)
    .eq('id', item.id);

  if (instance.auto_send_consecutive_failures > 0) {
    await from(supabase, 'whatsapp_instances' as never)
      .update({ auto_send_consecutive_failures: 0 } as never)
      .eq('id', instance.id);
  }

  // Timeline igual ao envio manual, com o SDR como autor e a marca de automático (critério 10).
  // O índice único por passo + lead impede um segundo 'sent' (critério 11).
  const { data: interaction, error } = (await from(supabase, 'interactions')
    .insert({
      org_id: item.org_id,
      lead_id: item.lead_id,
      cadence_id: item.cadence_id,
      step_id: item.step_id,
      channel: 'whatsapp',
      type: 'sent',
      message_content: message.body,
      external_id: externalId,
      ai_generated: message.aiGenerated,
      original_template_id: message.templateId,
      performed_by: item.sender_user_id,
      metadata: {
        auto_send: true,
        queue_item_id: item.id,
        ...(message.abVariant ? { ab_variant: message.abVariant } : {}),
      },
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: { code?: string; message: string } | null };

  if (error && error.code !== '23505') {
    console.error(`[whatsapp-auto-send] item=${item.id} enviado mas a interação não gravou:`, error.message);
  }
  if (interaction) {
    await from(supabase, 'whatsapp_send_queue' as never)
      .update({ interaction_id: interaction.id } as never)
      .eq('id', item.id);
  }

  markLeadContacted(supabase as never, item.lead_id).catch(() => {});
  await advance(supabase, item);
}

/** Avança a inscrição (RPC row-locked e idempotente) e trata o fim natural da cadência. */
async function advance(supabase: SupabaseClient, item: QueueItemRow): Promise<void> {
  const { data, error } = await (supabase.rpc as unknown as Rpc)('advance_enrollment_after_step', {
    p_enrollment_id: item.enrollment_id,
    p_executed_step_id: item.step_id,
    p_performed_by: item.sender_user_id,
  });
  if (error) {
    console.error(`[whatsapp-auto-send] item=${item.id} advance_enrollment_after_step falhou:`, error.message);
    return;
  }
  if (data?.[0]?.completed) {
    await logLeadEvent(supabase, {
      orgId: item.org_id,
      leadId: item.lead_id,
      userId: item.sender_user_id,
      event: 'cadence_completed',
      message: 'Cadência concluída — todos os passos foram executados',
      metadata: { cadence_id: item.cadence_id, enrollment_id: item.enrollment_id },
    });
    await markLeadLostOnCadenceEnd({
      orgId: item.org_id,
      leadId: item.lead_id,
      cadenceId: item.cadence_id,
      enrollmentId: item.enrollment_id,
    });
  }
}

/** Pula o passo (registra na timeline) e avança a cadência. */
async function skipStep(supabase: SupabaseClient, item: QueueItemRow, reason: 'max_unanswered'): Promise<void> {
  await from(supabase, 'whatsapp_send_queue' as never)
    .update({ status: 'skipped', reason } as never)
    .eq('id', item.id);
  await from(supabase, 'interactions').insert({
    org_id: item.org_id,
    lead_id: item.lead_id,
    cadence_id: item.cadence_id,
    channel: 'system',
    type: 'sent',
    message_content: `WhatsApp automático pulado: o lead já recebeu ${MAX_UNANSWERED} mensagens sem responder`,
    performed_by: null,
    metadata: { system_event: 'step_skipped_auto', skip_reason: reason, queue_item_id: item.id, step_id: item.step_id },
  } as Record<string, unknown>);
  await advance(supabase, item);
}

/** Destino sem WhatsApp: mesma marca do botão "Não é WhatsApp"; o motor avança os passos. */
async function markNotWhatsApp(supabase: SupabaseClient, item: QueueItemRow): Promise<void> {
  await from(supabase, 'leads')
    .update({ whatsapp_invalid_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', item.lead_id)
    .is('whatsapp_invalid_at', null);
  await from(supabase, 'interactions').insert({
    org_id: item.org_id,
    lead_id: item.lead_id,
    cadence_id: item.cadence_id,
    step_id: item.step_id,
    channel: 'whatsapp',
    type: 'failed',
    performed_by: item.sender_user_id,
    metadata: { error: 'not_whatsapp', auto_send: true, queue_item_id: item.id },
  } as Record<string, unknown>);
}

/**
 * Freio do número (critério 6): pausa a fila, desce um degrau do limite e avisa
 * SDR e gestores. Só a primeira rodada que pausa avisa (update condicional).
 */
export async function tripBrake(supabase: SupabaseClient, instance: InstanceRow, now: Date, reason: string): Promise<void> {
  const { data: paused } = (await from(supabase, 'whatsapp_instances' as never)
    .update({
      auto_send_paused_at: now.toISOString(),
      auto_send_pause_reason: reason,
      auto_send_daily_limit: limitAfterIncident(instance.auto_send_daily_limit),
      auto_send_limit_changed_on: brtDateKey(now),
      auto_send_consecutive_failures: 0,
    } as never)
    .eq('id', instance.id)
    .is('auto_send_paused_at', null)
    .select('id')) as { data: Array<{ id: string }> | null };
  if (!paused?.length) return;

  console.warn(`[whatsapp-auto-send] instance=${instance.id} user=${instance.user_id} PAUSADA: ${reason}`);
  const title = 'WhatsApp automático pausado';
  const body = `A fila de envio automático foi pausada (${reason}). Nada mais sai por esse número até alguém retomar.`;
  await notifySafe({
    org_id: instance.org_id,
    user_id: instance.user_id,
    type: 'integration_error',
    title,
    body,
    resource_type: 'integration',
  });
  try {
    await createNotificationsForOrgMembers({
      orgId: instance.org_id,
      type: 'integration_error',
      title,
      body: `${body} (SDR: ${instance.user_id})`,
      resourceType: 'integration',
      roleFilter: 'manager',
      excludeUserId: instance.user_id,
    });
  } catch (err) {
    console.error('[whatsapp-auto-send] aviso aos gestores falhou:', err);
  }
}

async function notifySafe(params: Parameters<typeof createNotification>[0]): Promise<void> {
  try {
    await createNotification(params);
  } catch (err) {
    console.error('[whatsapp-auto-send] notificação falhou:', err);
  }
}

async function hasWhatsAppReply(supabase: SupabaseClient, leadId: string): Promise<boolean> {
  const { data } = (await from(supabase, 'interactions')
    .select('id')
    .eq('lead_id', leadId)
    .eq('channel', 'whatsapp')
    .eq('type', 'replied')
    .limit(1)
    .maybeSingle()) as { data: { id: string } | null };
  return !!data;
}

/** Mensagens de WhatsApp enviadas ao lead desde a última resposta dele (ou desde sempre). */
async function countUnanswered(supabase: SupabaseClient, leadId: string): Promise<number> {
  const { data: lastReply } = (await from(supabase, 'interactions')
    .select('created_at')
    .eq('lead_id', leadId)
    .eq('channel', 'whatsapp')
    .eq('type', 'replied')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { created_at: string } | null };

  let q = from(supabase, 'interactions')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', leadId)
    .eq('channel', 'whatsapp')
    .eq('type', 'sent');
  if (lastReply) q = q.gt('created_at', lastReply.created_at);
  const { count } = (await q) as { count: number | null };
  return count ?? 0;
}

async function countSentToday(supabase: SupabaseClient, userId: string, now: Date, countedOnly: boolean): Promise<number> {
  let q = from(supabase, 'whatsapp_send_queue' as never)
    .select('id', { count: 'exact', head: true })
    .eq('sender_user_id', userId)
    .eq('status', 'sent')
    .gte('sent_at', brtDayStartIso(now));
  if (countedOnly) q = q.eq('counts_toward_limit', true);
  const { count } = (await q) as { count: number | null };
  return count ?? 0;
}

/** Tentativas de hoje que chegaram na Evolution: enviados + inválidos. */
async function countAttemptsToday(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
): Promise<{ attempts: number; invalid: number }> {
  const { count: invalid } = (await from(supabase, 'whatsapp_send_queue' as never)
    .select('id', { count: 'exact', head: true })
    .eq('sender_user_id', userId)
    .eq('status', 'failed')
    .eq('reason', 'invalid_number')
    .gte('updated_at', brtDayStartIso(now))) as { count: number | null };
  const sent = await countSentToday(supabase, userId, now, false);
  return { attempts: sent + (invalid ?? 0), invalid: invalid ?? 0 };
}
