'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { ERR_ALREADY_EXECUTED } from '@/lib/constants/error-codes';
import { from } from '@/lib/supabase/from';

import { EmailService } from '@/features/integrations/services/email.service';
import { EvolutionWhatsAppService } from '@/features/integrations/services/whatsapp-evolution.service';
import { WhatsAppCreditService } from '@/features/integrations/services/whatsapp-credit.service';
import { WhatsAppService } from '@/features/integrations/services/whatsapp.service';
import type { InteractionRow } from '@/features/cadences/types';

import { toPlainText } from '@/lib/utils/html-to-plaintext';
import { withTimeout } from '@/lib/utils/with-timeout';

import { markLeadContacted } from '@/features/leads/actions/mark-contacted';
import { createNotification } from '@/features/notifications/services/notification.service';

import type { ExecuteActivityInput } from '../types';

const executeActivitySchema = z.object({
  enrollmentId: z.string().uuid(),
  cadenceId: z.string().uuid(),
  stepId: z.string().uuid(),
  leadId: z.string().uuid(),
  orgId: z.string().uuid(),
  cadenceCreatedBy: z.string().min(1),
  channel: z.string().min(1),
  to: z.string(),
  subject: z.string(),
  body: z.string(),
  aiGenerated: z.boolean(),
  templateId: z.string().uuid().nullable(),
});

export async function executeActivity(
  input: ExecuteActivityInput,
): Promise<ActionResult<{ interactionId: string }>> {
  const parsed = executeActivitySchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  // Channels that send external messages require a recipient
  const sendChannels = ['email', 'whatsapp'];
  if (sendChannels.includes(input.channel) && !input.to?.trim()) {
    return { success: false, error: 'Destinatário é obrigatório para este canal' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { userId, supabase } = auth.data;

  const {
    enrollmentId,
    cadenceId,
    stepId,
    leadId,
    orgId,
    cadenceCreatedBy: _cadenceCreatedBy,
    channel,
    to,
    subject,
    body,
    aiGenerated,
    templateId,
  } = input;

  // Idempotency check: skip if interaction already exists for this step + lead
  // Allow retry if previous attempt failed
  const { data: existingInteraction } = (await from(supabase, 'interactions')
    .select('id')
    .eq('cadence_id', cadenceId)
    .eq('step_id', stepId)
    .eq('lead_id', leadId)
    .neq('type', 'failed')
    .limit(1)
    .maybeSingle()) as { data: { id: string } | null };

  if (existingInteraction) {
    return { success: false, error: 'Esta atividade já foi executada', code: ERR_ALREADY_EXECUTED };
  }

  // Record interaction
  const { data: interaction } = (await from(supabase, 'interactions')
    .insert({
      org_id: orgId,
      lead_id: leadId,
      cadence_id: cadenceId,
      step_id: stepId,
      channel: channel || 'email',
      type: 'sent',
      message_content: body ? toPlainText(body) : null,
      metadata: {
        ...(subject ? { subject } : {}),
        ...(body ? { html_body: body } : {}),
      },
      ai_generated: aiGenerated,
      original_template_id: templateId,
      performed_by: userId,
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: Pick<InteractionRow, 'id'> | null };

  if (!interaction) {
    return { success: false, error: 'Falha ao registrar interação' };
  }

  // Send via appropriate channel
  if (channel === 'whatsapp') {
    // Check and deduct credit (only for Meta API — Evolution doesn't use credits)
    const { data: hasMetaConnection } = (await from(supabase, 'whatsapp_connections')
      .select('id')
      .eq('org_id', orgId)
      .eq('status', 'connected')
      .limit(1)
      .maybeSingle()) as { data: { id: string } | null };

    // Deduct WhatsApp credit regardless of provider (Meta or Evolution).
    // Originally this was gated on `hasMetaConnection`, leaving Evolution sends
    // uncounted — orgs on limited plans could send unlimited WhatsApp for free
    // and the billing dashboard reported used_credits=0 even with hundreds of
    // sends. The credit row tracks plan-level usage, not provider-specific.
    const creditResult = await WhatsAppCreditService.checkAndDeductCredit(orgId, supabase);
    if (!creditResult.allowed) {
      await from(supabase, 'interactions')
        .update({ type: 'failed', metadata: { error: creditResult.error ?? 'no_credits' } } as Record<string, unknown>)
        .eq('id', interaction.id);
      return { success: false, error: creditResult.error ?? 'Sem créditos WhatsApp' };
    }

    // Try Meta WhatsApp API first, then Evolution API
    let waResult: { success: boolean; messageId?: string; error?: string };

    if (hasMetaConnection) {
      waResult = await WhatsAppService.sendMessage(orgId, { to, body }, supabase);
    } else {
      waResult = await EvolutionWhatsAppService.sendMessage(orgId, { to, body }, supabase, userId);
    }

    if (waResult.success && waResult.messageId) {
      await from(supabase, 'interactions')
        .update({ external_id: waResult.messageId } as Record<string, unknown>)
        .eq('id', interaction.id);
    } else {
      await from(supabase, 'interactions')
        .update({ type: 'failed', metadata: { error: waResult.error ?? 'whatsapp_send_error' } } as Record<string, unknown>)
        .eq('id', interaction.id);
      return { success: false, error: waResult.error ?? 'Falha ao enviar WhatsApp' };
    }
  } else if (channel === 'email') {
    // Email flow (30s timeout) — send from the SDR's own Gmail, not the cadence creator's
    const emailResult = await withTimeout(
      EmailService.sendEmail(
        userId,
        orgId,
        {
          to,
          subject: subject || '',
          htmlBody: body,
        },
        interaction.id,
        supabase,
      ),
      30_000,
      'Email send',
    );

    if (emailResult.success && emailResult.messageId) {
      // Store messageId, threadId and RFC Message-ID for reply tracking
      const updateData: Record<string, unknown> = { external_id: emailResult.messageId };
      const meta: Record<string, unknown> = {};
      if (subject) meta.subject = subject;
      if (body) meta.html_body = body;
      if (emailResult.threadId) meta.thread_id = emailResult.threadId;
      if (emailResult.rfcMessageId) meta.rfc_message_id = emailResult.rfcMessageId;
      if (Object.keys(meta).length > 0) updateData.metadata = meta;
      await from(supabase, 'interactions')
        .update(updateData)
        .eq('id', interaction.id);
    } else {
      await from(supabase, 'interactions')
        .update({ type: 'failed', metadata: { error: emailResult.error ?? 'email_send_error' } } as Record<string, unknown>)
        .eq('id', interaction.id);
      return { success: false, error: emailResult.error ?? 'Falha ao enviar email' };
    }
  }
  // Manual channels (phone, linkedin, research) — interaction already recorded above, no external send needed

  // Mark lead as contacted on first activity
  markLeadContacted(supabase, leadId).catch(() => {});

  // Advance step or mark enrollment completed.
  //
  // Bug 26/05/2026 (lead Chopp Brahma): SDR executava o step do meio
  // de um lote D+0 e os steps anteriores sumiam da fila SEM rastro —
  // o cursor pulava direto pra depois do executado. Ismael fez WhatsApp,
  // o phone do mesmo dia virou inacessível e nem aparecia na timeline.
  //
  // Fix: antes de avançar, computar quais step_orders ficaram pulados
  // (entre o current_step antigo e o executado, exclusive do executado)
  // e registrar uma interaction `step_skipped` por cada um. Mantém o
  // comportamento de UX (fila avança pra frente, SDR não fica refazendo)
  // e ganha auditoria completa na timeline do lead.
  const { data: executedStep } = (await from(supabase, 'cadence_steps')
    .select('step_order')
    .eq('id', stepId)
    .single()) as { data: { step_order: number } | null };
  const executedStepOrder = executedStep?.step_order ?? 0;

  const { data: currentEnrollment } = (await from(supabase, 'cadence_enrollments')
    .select('current_step')
    .eq('id', enrollmentId)
    .single()) as { data: { current_step: number } | null };
  const oldCurrentStep = currentEnrollment?.current_step ?? executedStepOrder;

  const { data: nextStep } = (await from(supabase, 'cadence_steps')
    .select('step_order')
    .eq('cadence_id', cadenceId)
    .gt('step_order', executedStepOrder)
    .order('step_order', { ascending: true })
    .limit(1)
    .maybeSingle()) as { data: { step_order: number } | null };

  // Log skipped steps in the timeline. The executed step itself doesn't
  // count as skipped — we look strictly at the gap [oldCurrentStep, executedStepOrder).
  if (executedStepOrder > oldCurrentStep) {
    const { data: skipped } = (await from(supabase, 'cadence_steps')
      .select('id, step_order, channel')
      .eq('cadence_id', cadenceId)
      .gte('step_order', oldCurrentStep)
      .lt('step_order', executedStepOrder)
      .order('step_order', { ascending: true })) as {
        data: Array<{ id: string; step_order: number; channel: string }> | null;
      };
    if (skipped && skipped.length > 0) {
      const skippedInteractions = skipped.map((s) => ({
        org_id: input.orgId,
        lead_id: leadId,
        cadence_id: cadenceId,
        step_id: s.id,
        channel: 'system',
        type: 'sent',
        message_content: `Step ${s.step_order} (${s.channel}) pulado — SDR executou o step ${executedStepOrder} (${input.channel}) primeiro.`,
        performed_by: userId,
        metadata: {
          system_event: 'step_skipped',
          reason: 'advanced_past',
          skipped_step_order: s.step_order,
          skipped_channel: s.channel,
          executed_step_order: executedStepOrder,
          executed_channel: input.channel,
        },
      }));
      await from(supabase, 'interactions').insert(skippedInteractions as unknown as Record<string, unknown>);
    }
  }

  if (nextStep) {
    await from(supabase, 'cadence_enrollments')
      .update({ current_step: nextStep.step_order } as Record<string, unknown>)
      .eq('id', enrollmentId);
  } else {
    await from(supabase, 'cadence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', enrollmentId);

    // Notify SDR that cadence is completed for this lead
    const leadDisplay = input.to || leadId.slice(0, 8);
    createNotification({
        org_id: orgId,
        user_id: userId,
        type: 'cadence_completed',
        title: 'Cadência concluída',
        body: `Todos os steps foram executados para ${leadDisplay}`,
        resource_type: 'lead',
        resource_id: leadId,
      }).catch((err) => console.error('[notification] cadence_completed failed:', err));
  }

  revalidatePath('/atividades');

  return { success: true, data: { interactionId: interaction.id } };
}
