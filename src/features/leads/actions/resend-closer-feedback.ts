'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { sendCloserFeedbackEmail, type SendFeedbackChannelResult } from './send-closer-feedback';

const inputSchema = z.object({
  leadId: z.string().uuid('Lead inválido'),
});

interface LeadRow {
  id: string;
  closer_id: string | null;
  nome_fantasia: string | null;
  razao_social: string | null;
}

interface CloserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

interface PendingRequestRow {
  id: string;
}

/**
 * Re-trigger a closer feedback notification (email + WhatsApp via the org
 * manager's Evolution instance). Reuses any pending request for the lead/closer
 * pair so the closer keeps the original link; only creates a new row if none
 * exists.
 */
export async function resendCloserFeedback(
  input: z.infer<typeof inputSchema>,
): Promise<ActionResult<SendFeedbackChannelResult>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { data: lead } = (await from(supabase, 'leads')
    .select('id, closer_id, nome_fantasia, razao_social')
    .eq('id', parsed.data.leadId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .maybeSingle()) as { data: LeadRow | null };

  if (!lead) {
    return { success: false, error: 'Lead não encontrado' };
  }
  if (!lead.closer_id) {
    return { success: false, error: 'Lead não possui closer atribuído' };
  }

  const { data: closer } = (await from(supabase, 'closers')
    .select('id, name, email, phone')
    .eq('id', lead.closer_id)
    .eq('org_id', orgId)
    .maybeSingle()) as { data: CloserRow | null };

  if (!closer) {
    return { success: false, error: 'Closer não encontrado' };
  }

  // Require at least one pending request — avoids creating a new feedback
  // cycle just because someone clicked the button on an old won lead. The
  // service itself will reuse this row instead of creating a new one.
  const { data: pending } = (await from(supabase, 'closer_feedback_requests')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('closer_id', closer.id)
    .is('responded_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()) as { data: PendingRequestRow | null };

  if (!pending) {
    return { success: false, error: 'Nenhum feedback pendente para este lead' };
  }

  const leadName = lead.nome_fantasia ?? lead.razao_social ?? 'Lead';
  const result = await sendCloserFeedbackEmail({
    leadId: lead.id,
    orgId,
    closerId: closer.id,
    closerName: closer.name,
    closerEmail: closer.email,
    closerPhone: closer.phone,
    leadName,
    senderUserId: userId,
  });

  if (result.email !== 'sent' && result.whatsapp !== 'sent') {
    return {
      success: false,
      error: result.emailError ?? result.whatsappError ?? 'Falha ao enviar feedback',
    };
  }

  return { success: true, data: result };
}
