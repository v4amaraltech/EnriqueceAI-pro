'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { EmailService } from '@/features/integrations/services/email.service';
import { EvolutionWhatsAppService } from '@/features/integrations/services/whatsapp-evolution.service';
import { WhatsAppCreditService } from '@/features/integrations/services/whatsapp-credit.service';
import { WhatsAppService } from '@/features/integrations/services/whatsapp.service';

import { toPlainText } from '@/lib/utils/html-to-plaintext';

const schema = z.object({
  scheduledActivityId: z.string().uuid(),
  leadId: z.string().uuid(),
  channel: z.string().min(1),
  to: z.string(),
  subject: z.string(),
  body: z.string(),
  aiGenerated: z.boolean(),
});

type ExecuteScheduledInput = z.infer<typeof schema>;

export async function executeScheduledActivity(
  input: ExecuteScheduledInput,
): Promise<ActionResult<{ interactionId: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const sendChannels = ['email', 'whatsapp'];
  if (sendChannels.includes(input.channel) && !input.to?.trim()) {
    return { success: false, error: 'Destinatário é obrigatório para este canal' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { scheduledActivityId, leadId, channel, to, subject, body, aiGenerated } = input;

  // Record interaction
  const { data: interaction } = (await from(supabase, 'interactions')
    .insert({
      org_id: orgId,
      lead_id: leadId,
      channel: channel || 'phone',
      type: 'sent',
      message_content: body ? toPlainText(body) : null,
      metadata: {
        ...(subject ? { subject } : {}),
        ...(body ? { html_body: body } : {}),
        scheduled_activity_id: scheduledActivityId,
      },
      ai_generated: aiGenerated,
      performed_by: userId,
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null };

  if (!interaction) {
    return { success: false, error: 'Falha ao registrar interação' };
  }

  // Send via appropriate channel
  if (channel === 'whatsapp') {
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
    const emailResult = await EmailService.sendEmail(
      userId,
      orgId,
      { to, subject: subject || '', htmlBody: body },
      interaction.id,
      supabase,
    );

    if (emailResult.success && emailResult.messageId) {
      const updateData: Record<string, unknown> = { external_id: emailResult.messageId };
      if (emailResult.threadId) {
        updateData.metadata = {
          ...(subject ? { subject } : {}),
          ...(body ? { html_body: body } : {}),
          thread_id: emailResult.threadId,
          scheduled_activity_id: scheduledActivityId,
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

  // Mark scheduled activity as completed
  await from(supabase, 'scheduled_activities' as never)
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', scheduledActivityId);

  revalidatePath('/atividades');

  return { success: true, data: { interactionId: interaction.id } };
}
