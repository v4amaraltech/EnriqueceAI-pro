'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
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

  // Idempotency check: a non-failed interaction already exists for this step.
  // Antes isso retornava erro e parava — mas se o avanço anterior tivesse
  // falhado APÓS gravar a interaction, o enrollment ficava preso pra sempre
  // (a fila esconde o step via get_executed_steps, então o SDR nunca reexecuta).
  // Agora reconcilia: garante o avanço atômico via RPC e retorna sucesso.
  const { data: existingInteraction } = (await from(supabase, 'interactions')
    .select('id')
    .eq('cadence_id', cadenceId)
    .eq('step_id', stepId)
    .eq('lead_id', leadId)
    .neq('type', 'failed')
    .limit(1)
    .maybeSingle()) as { data: { id: string } | null };

  if (existingInteraction) {
    await advanceEnrollment(supabase, { enrollmentId, stepId, userId, leadId, to: input.to, orgId });
    revalidatePath('/atividades');
    return { success: true, data: { interactionId: existingInteraction.id } };
  }

  // Para channel=phone, reaproveita a interaction `internal_api4com` que
  // initiateApi4ComCall já gravou nos últimos 30min (mesmo lead + SDR) —
  // anexando cadence_id/step_id. Antes, executeActivity sempre criava
  // uma row nova, fazendo 1 ligação real virar 3 interactions (initiate +
  // classify + execute). V4 Amaral acumulou 257 phone fantasmas hoje
  // (27/05/2026); Matheus reportou contador subindo +3 por ligação.
  let reusedInteractionId: string | null = null;
  if (channel === 'phone') {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: candidate } = (await from(supabase, 'interactions')
      .select('id, cadence_id, step_id, metadata')
      .eq('lead_id', leadId)
      .eq('performed_by', userId)
      .eq('channel', 'phone')
      .is('cadence_id', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: { id: string; cadence_id: string | null; step_id: string | null; metadata: Record<string, unknown> | null } | null };
    if (candidate) reusedInteractionId = candidate.id;
  }

  let interaction: Pick<InteractionRow, 'id'> | null;
  if (reusedInteractionId) {
    const { data: updated } = (await from(supabase, 'interactions')
      .update({
        cadence_id: cadenceId,
        step_id: stepId,
        ai_generated: aiGenerated,
        original_template_id: templateId,
        ...(body ? { message_content: toPlainText(body) } : {}),
      } as Record<string, unknown>)
      .eq('id', reusedInteractionId)
      .select('id')
      .single()) as { data: Pick<InteractionRow, 'id'> | null };
    interaction = updated;
  } else {
    const { data: inserted } = (await from(supabase, 'interactions')
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
    interaction = inserted;
  }

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

  // Advance step (or complete) atomically. Single RPC, row-locked e idempotente
  // — substitui os ~5 round-trips que antes podiam estrangular o avanço e deixar
  // o enrollment preso num step já feito. O RPC também audita steps pulados.
  await advanceEnrollment(supabase, { enrollmentId, stepId, userId, leadId, to: input.to, orgId });

  revalidatePath('/atividades');

  return { success: true, data: { interactionId: interaction.id } };
}

interface AdvanceArgs {
  enrollmentId: string;
  stepId: string;
  userId: string;
  leadId: string;
  to: string;
  orgId: string;
}

/**
 * Avança o enrollment após um step executado, atomicamente, via RPC
 * `advance_enrollment_after_step` (row-locked + idempotente). Reexecuções,
 * retries e duplos cliques não duplicam nem regridem o cursor. Dispara a
 * notificação de cadência concluída quando o RPC sinaliza `completed`.
 *
 * Tolerante a erro: loga e retorna sem estourar a action — o estado fica
 * reconciliável por uma nova execução (o RPC é idempotente).
 */
async function advanceEnrollment(
  supabase: SupabaseClient,
  { enrollmentId, stepId, userId, leadId, to, orgId }: AdvanceArgs,
): Promise<void> {
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: Array<{ advanced: boolean; completed: boolean; new_step: number | null }> | null;
    error: { message: string } | null;
  }>)('advance_enrollment_after_step', {
    p_enrollment_id: enrollmentId,
    p_executed_step_id: stepId,
    p_performed_by: userId,
  });

  if (error) {
    console.error('[execute-activity] advance_enrollment_after_step falhou:', error.message);
    return;
  }

  if (data?.[0]?.completed) {
    const leadDisplay = to || leadId.slice(0, 8);
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
}
