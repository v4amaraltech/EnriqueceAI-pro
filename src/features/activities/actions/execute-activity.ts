'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { ERR_ALREADY_EXECUTED } from '@/lib/constants/error-codes';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

import { EmailService } from '@/features/integrations/services/email.service';
import { EvolutionWhatsAppService } from '@/features/integrations/services/whatsapp-evolution.service';
import { WhatsAppCreditService } from '@/features/integrations/services/whatsapp-credit.service';
import { WhatsAppService } from '@/features/integrations/services/whatsapp.service';
import type { InteractionRow } from '@/features/cadences/types';

import { toPlainText } from '@/lib/utils/html-to-plaintext';

import type { ExecuteActivityInput } from '../types';

export async function executeActivity(
  input: ExecuteActivityInput,
): Promise<ActionResult<{ interactionId: string }>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const {
    enrollmentId,
    cadenceId,
    stepId,
    leadId,
    orgId,
    cadenceCreatedBy,
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
      performed_by: user.id,
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

    if (hasMetaConnection) {
      const creditResult = await WhatsAppCreditService.checkAndDeductCredit(orgId, supabase);
      if (!creditResult.allowed) {
        await from(supabase, 'interactions')
          .update({ type: 'failed', metadata: { error: creditResult.error ?? 'no_credits' } } as Record<string, unknown>)
          .eq('id', interaction.id);
        return { success: false, error: creditResult.error ?? 'Sem créditos WhatsApp' };
      }
    }

    // Try Meta WhatsApp API first, then Evolution API
    let waResult: { success: boolean; messageId?: string; error?: string };

    if (hasMetaConnection) {
      waResult = await WhatsAppService.sendMessage(orgId, { to, body }, supabase);
    } else {
      waResult = await EvolutionWhatsAppService.sendMessage(orgId, { to, body }, supabase);
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
    // Email flow
    const emailResult = await EmailService.sendEmail(
      cadenceCreatedBy,
      orgId,
      {
        to,
        subject: subject || '',
        htmlBody: body,
      },
      interaction.id,
      supabase,
    );

    if (emailResult.success && emailResult.messageId) {
      // Store messageId and threadId for reply tracking
      const updateData: Record<string, unknown> = { external_id: emailResult.messageId };
      if (emailResult.threadId) {
        updateData.metadata = {
          ...(subject ? { subject } : {}),
          ...(body ? { html_body: body } : {}),
          thread_id: emailResult.threadId,
        };
      }
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

  // Advance step or mark enrollment completed
  const { data: nextStep } = (await from(supabase, 'cadence_steps')
    .select('step_order')
    .eq('cadence_id', cadenceId)
    .gt('step_order', (await from(supabase, 'cadence_steps')
      .select('step_order')
      .eq('id', stepId)
      .single()).data?.step_order ?? 0)
    .order('step_order', { ascending: true })
    .limit(1)
    .maybeSingle()) as { data: { step_order: number } | null };

  if (nextStep) {
    await from(supabase, 'cadence_enrollments')
      .update({ current_step: nextStep.step_order } as Record<string, unknown>)
      .eq('id', enrollmentId);
  } else {
    await from(supabase, 'cadence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', enrollmentId);
  }

  revalidatePath('/atividades');

  return { success: true, data: { interactionId: interaction.id } };
}
