'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { EmailService } from '@/features/integrations/services/email.service';
import { WhatsAppCreditService } from '@/features/integrations/services/whatsapp-credit.service';
import { WhatsAppService } from '@/features/integrations/services/whatsapp.service';
import type { InteractionRow } from '@/features/cadences/types';

import type { ExecuteActivityInput } from '../types';

/** Strip HTML tags and normalize whitespace for plain-text storage */
function toPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
  const { data: existingInteraction } = (await (supabase
    .from('interactions') as ReturnType<typeof supabase.from>)
    .select('id')
    .eq('cadence_id', cadenceId)
    .eq('step_id', stepId)
    .eq('lead_id', leadId)
    .limit(1)
    .maybeSingle()) as { data: { id: string } | null };

  if (existingInteraction) {
    return { success: false, error: 'Esta atividade já foi executada', code: 'ALREADY_EXECUTED' };
  }

  // Record interaction
  const { data: interaction } = (await (supabase
    .from('interactions') as ReturnType<typeof supabase.from>)
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
    // Check and deduct credit
    const creditResult = await WhatsAppCreditService.checkAndDeductCredit(orgId, supabase);
    if (!creditResult.allowed) {
      // Mark interaction as failed before returning
      await (supabase.from('interactions') as ReturnType<typeof supabase.from>)
        .update({ type: 'failed', metadata: { error: creditResult.error ?? 'no_credits' } } as Record<string, unknown>)
        .eq('id', interaction.id);
      return { success: false, error: creditResult.error ?? 'Sem créditos WhatsApp' };
    }

    const waResult = await WhatsAppService.sendMessage(
      orgId,
      { to, body },
      supabase,
    );

    if (waResult.success && waResult.messageId) {
      await (supabase.from('interactions') as ReturnType<typeof supabase.from>)
        .update({ external_id: waResult.messageId } as Record<string, unknown>)
        .eq('id', interaction.id);
    } else {
      await (supabase.from('interactions') as ReturnType<typeof supabase.from>)
        .update({ type: 'failed', metadata: { error: waResult.error ?? 'whatsapp_send_error' } } as Record<string, unknown>)
        .eq('id', interaction.id);
      return { success: false, error: waResult.error ?? 'Falha ao enviar WhatsApp' };
    }
  } else {
    // Email flow (default)
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
      await (supabase.from('interactions') as ReturnType<typeof supabase.from>)
        .update(updateData)
        .eq('id', interaction.id);
    } else {
      await (supabase.from('interactions') as ReturnType<typeof supabase.from>)
        .update({ type: 'failed', metadata: { error: emailResult.error ?? 'email_send_error' } } as Record<string, unknown>)
        .eq('id', interaction.id);
      return { success: false, error: emailResult.error ?? 'Falha ao enviar email' };
    }
  }

  // Advance step or mark enrollment completed
  const { data: nextStep } = (await (supabase
    .from('cadence_steps') as ReturnType<typeof supabase.from>)
    .select('step_order')
    .eq('cadence_id', cadenceId)
    .gt('step_order', (await (supabase
      .from('cadence_steps') as ReturnType<typeof supabase.from>)
      .select('step_order')
      .eq('id', stepId)
      .single()).data?.step_order ?? 0)
    .order('step_order', { ascending: true })
    .limit(1)
    .maybeSingle()) as { data: { step_order: number } | null };

  if (nextStep) {
    await (supabase.from('cadence_enrollments') as ReturnType<typeof supabase.from>)
      .update({ current_step: nextStep.step_order } as Record<string, unknown>)
      .eq('id', enrollmentId);
  } else {
    await (supabase.from('cadence_enrollments') as ReturnType<typeof supabase.from>)
      .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', enrollmentId);
  }

  revalidatePath('/atividades');

  return { success: true, data: { interactionId: interaction.id } };
}
