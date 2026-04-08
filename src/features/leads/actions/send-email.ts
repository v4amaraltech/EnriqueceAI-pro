'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { EmailService } from '@/features/integrations/services/email.service';

interface SendManualEmailInput {
  to: string;
  subject: string;
  body: string;
}

export async function sendManualEmail(
  leadId: string,
  input: SendManualEmailInput,
): Promise<ActionResult<{ messageId?: string }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  if (!input.to || !input.subject || !input.body) {
    return { success: false, error: 'Preencha todos os campos' };
  }

  // Create interaction record first
  const { data: interaction, error: interactionError } = (await from(supabase, 'interactions')
    .insert({
      org_id: orgId,
      lead_id: leadId,
      channel: 'email',
      type: 'sent',
      message_content: input.body,
      ai_generated: false,
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  const qErr = handleQueryError(interactionError, 'Erro ao registrar interação', 'send-email');
  if (qErr || !interaction) return qErr ?? { success: false, error: 'Erro ao registrar interação' };

  // Send the email
  const result = await EmailService.sendEmail(
    userId,
    orgId,
    {
      to: input.to,
      subject: input.subject,
      htmlBody: `<html><body>${input.body.replace(/\n/g, '<br/>')}</body></html>`,
      trackOpens: true,
      trackClicks: true,
    },
    interaction.id,
  );

  if (!result.success) {
    // Update interaction to failed
    await from(supabase, 'interactions')
      .update({ type: 'failed' } as Record<string, unknown>)
      .eq('id', interaction.id);

    return { success: false, error: result.error ?? 'Erro ao enviar email' };
  }

  // Update lead status to contacted if still new
  await from(supabase, 'leads')
    .update({ status: 'contacted', contacted_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', leadId)
    .eq('status', 'new');

  revalidatePath(`/leads/${leadId}`);

  return { success: true, data: { messageId: result.messageId } };
}
