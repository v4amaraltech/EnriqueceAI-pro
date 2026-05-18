'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { getAppUrl } from '@/lib/utils/app-url';
import { WhatsAppCreditService } from '../services/whatsapp-credit.service';

import { EvolutionWhatsAppService } from '../services/whatsapp-evolution.service';

// Banner image attached to the meeting invite. Public asset served by Next.js
// from /public/whatsapp/. Sent as the WhatsApp media with the invite text as
// caption so it lands as a single message in the lead's inbox.
const INVITE_BANNER_PATH = '/whatsapp/encontro-v4-banner.png';

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

  // Same plan-level quota that execute-activity / execute-scheduled-activity
  // enforce. Until 2026-05-13 this path was uncounted, letting V4 Amaral
  // (and any other org with active meeting flow) burn ~360 invites/month
  // off the books while the credit row showed used=0.
  const creditResult = await WhatsAppCreditService.checkAndDeductCredit(orgId, supabase);
  if (!creditResult.allowed) {
    return { success: false, error: creditResult.error ?? 'Sem créditos WhatsApp', code: 'NO_CREDITS' };
  }

  // Send via Evolution API as image + caption so the V4 banner and the
  // invite text land as a single WhatsApp message.
  const mediaUrl = `${getAppUrl()}${INVITE_BANNER_PATH}`;
  const result = await EvolutionWhatsAppService.sendMedia(
    orgId,
    {
      to: phone,
      mediaUrl,
      mediatype: 'image',
      mimetype: 'image/png',
      fileName: 'encontro-v4.png',
      caption: input.message,
    },
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
