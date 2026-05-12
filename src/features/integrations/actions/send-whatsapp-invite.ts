'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { EvolutionWhatsAppService } from '../services/whatsapp-evolution.service';

interface SendWhatsAppInviteInput {
  leadId: string;
  message: string;
}

export async function sendWhatsAppInvite(
  input: SendWhatsAppInviteInput,
): Promise<ActionResult<{ messageId?: string }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Get lead phone
  const { data: lead } = (await from(supabase, 'leads')
    .select('id, telefone, phones, first_name, last_name')
    .eq('id', input.leadId)
    .eq('org_id', orgId)
    .maybeSingle()) as {
    data: {
      id: string;
      telefone: string | null;
      phones: Array<{ tipo: string; numero: string }> | null;
      first_name: string | null;
      last_name: string | null;
    } | null;
  };

  if (!lead) {
    return { success: false, error: 'Lead não encontrado' };
  }

  // Find best WhatsApp number: prioritize phones with tipo='whatsapp' or 'celular', fallback to telefone
  let phone: string | null = null;

  if (lead.phones?.length) {
    const whatsappPhone = lead.phones.find((p) => p.tipo === 'whatsapp');
    const celularPhone = lead.phones.find((p) => p.tipo === 'celular');
    phone = whatsappPhone?.numero ?? celularPhone?.numero ?? lead.phones[0]?.numero ?? null;
  }

  if (!phone && lead.telefone) {
    phone = lead.telefone;
  }

  if (!phone) {
    return { success: false, error: 'Lead não possui telefone cadastrado', code: 'NO_PHONE' };
  }

  // Send via Evolution API
  const result = await EvolutionWhatsAppService.sendMessage(
    orgId,
    { to: phone, body: input.message },
    supabase,
    userId,
  );

  if (!result.success) {
    return { success: false, error: result.error ?? 'Erro ao enviar WhatsApp', code: 'SEND_FAILED' };
  }

  // Register interaction. external_id goes in the top-level column (used by
  // reply matching and dedup); metadata holds the descriptive system_event.
  await from(supabase, 'interactions')
    .insert({
      org_id: orgId,
      lead_id: input.leadId,
      type: 'sent',
      channel: 'whatsapp',
      message_content: input.message,
      external_id: result.messageId,
      metadata: {
        system_event: 'meeting_invite_sent',
      },
      performed_by: userId,
    } as Record<string, unknown>);

  return { success: true, data: { messageId: result.messageId } };
}
