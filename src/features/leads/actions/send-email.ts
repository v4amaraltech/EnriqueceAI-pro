'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
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
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  if (!input.to || !input.subject || !input.body) {
    return { success: false, error: 'Preencha todos os campos' };
  }

  // Create interaction record first
  const { data: interaction, error: interactionError } = (await from(supabase, 'interactions')
    .insert({
      org_id: member.org_id,
      lead_id: leadId,
      channel: 'email',
      type: 'sent',
      message_content: input.body,
      ai_generated: false,
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (interactionError) {
    return { success: false, error: 'Erro ao registrar interação' };
  }

  // Send the email
  const result = await EmailService.sendEmail(
    user.id,
    member.org_id,
    {
      to: input.to,
      subject: input.subject,
      htmlBody: `<html><body>${input.body.replace(/\n/g, '<br/>')}</body></html>`,
      trackOpens: true,
      trackClicks: true,
    },
    interaction?.id,
  );

  if (!result.success) {
    // Update interaction to failed
    await from(supabase, 'interactions')
      .update({ type: 'failed' } as Record<string, unknown>)
      .eq('id', interaction!.id);

    return { success: false, error: result.error ?? 'Erro ao enviar email' };
  }

  // Update lead status to contacted if still new
  await from(supabase, 'leads')
    .update({ status: 'contacted' } as Record<string, unknown>)
    .eq('id', leadId)
    .eq('status', 'new');

  revalidatePath(`/leads/${leadId}`);

  return { success: true, data: { messageId: result.messageId } };
}
