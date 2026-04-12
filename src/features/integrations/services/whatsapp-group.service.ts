'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { validateBrazilianPhone } from './whatsapp.service';

interface CreateGroupResult {
  success: boolean;
  groupId?: string;
  error?: string;
}

interface MeetingGroupParams {
  orgId: string;
  sdrUserId: string;
  closerId: string;
  leadPhone: string;
  leadCompanyName: string;
  meetingTitle: string;
  meetingDate: string;
  meetingTime: string;
  meetLink: string | null;
}

/**
 * Creates a WhatsApp group for a scheduled meeting via Evolution API.
 * Group name: "V4 Company <> {Company Name}"
 * Members: SDR + Closer + Lead
 */
export async function createMeetingWhatsAppGroup(
  supabase: SupabaseClient,
  params: MeetingGroupParams,
): Promise<CreateGroupResult> {
  const { orgId, sdrUserId, closerId, leadPhone, leadCompanyName, meetingTitle, meetingDate, meetingTime, meetLink } = params;

  try {
    const apiUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;

    if (!apiUrl || !apiKey) {
      return { success: false, error: 'Evolution API não configurada' };
    }

    // 1. Get SDR's WhatsApp instance (the one creating the group)
    const { data: sdrInstance } = (await from(supabase, 'whatsapp_instances' as never)
      .select('id, instance_name, status, phone')
      .eq('org_id', orgId)
      .eq('user_id', sdrUserId)
      .maybeSingle()) as { data: { id: string; instance_name: string; status: string; phone: string | null } | null };

    if (!sdrInstance || sdrInstance.status !== 'connected' || !sdrInstance.phone) {
      console.warn('[whatsapp-group] SDR WhatsApp not connected, skipping group creation');
      return { success: false, error: 'WhatsApp do SDR não conectado' };
    }

    // 2. Get Closer's phone from closers table
    const { data: closer } = (await from(supabase, 'closers')
      .select('phone')
      .eq('id', closerId)
      .maybeSingle()) as { data: { phone: string | null } | null };

    if (!closer?.phone) {
      console.warn('[whatsapp-group] Closer phone not registered, skipping group creation');
      return { success: false, error: 'Telefone do Closer não cadastrado' };
    }

    // 3. Validate and format phone numbers
    const leadPhoneFormatted = validateBrazilianPhone(leadPhone);
    if (!leadPhoneFormatted) {
      return { success: false, error: 'Telefone do lead inválido' };
    }

    const closerPhoneFormatted = closer.phone.replace(/\D/g, '');

    const participants = [
      `${closerPhoneFormatted}@s.whatsapp.net`,
      `${leadPhoneFormatted}@s.whatsapp.net`,
    ];

    // 4. Create group via Evolution API
    const groupName = `V4 Company <> ${leadCompanyName}`;

    const createResponse = await fetch(
      `${apiUrl.replace(/\/+$/, '')}/group/create/${sdrInstance.instance_name}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
        },
        body: JSON.stringify({
          subject: groupName,
          participants,
        }),
      },
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('[whatsapp-group] Create failed:', createResponse.status, errorText);
      return { success: false, error: `Erro ao criar grupo: ${createResponse.status}` };
    }

    const createData = (await createResponse.json()) as { id?: string; groupMetadata?: { id?: string } };
    const groupId = createData.id ?? createData.groupMetadata?.id;

    if (!groupId) {
      console.error('[whatsapp-group] No group ID returned');
      return { success: false, error: 'Grupo criado mas ID não retornado' };
    }

    // 5. Send meeting invite message to the group
    const inviteMessage = [
      `📋 *${meetingTitle}*`,
      `📅 ${meetingDate}`,
      `🕐 ${meetingTime}`,
      meetLink ? `\n🔗 Link da reunião:\n${meetLink}` : '',
      `\nTe esperamos lá! 🤝`,
    ].filter(Boolean).join('\n');

    await fetch(
      `${apiUrl.replace(/\/+$/, '')}/message/sendText/${sdrInstance.instance_name}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
        },
        body: JSON.stringify({
          number: groupId,
          text: inviteMessage,
        }),
      },
    ).catch((err) => console.error('[whatsapp-group] Failed to send invite message:', err));

    console.warn(`[whatsapp-group] Group created: "${groupName}" id=${groupId}`);
    return { success: true, groupId };
  } catch (err) {
    console.error('[whatsapp-group] Unexpected error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Erro desconhecido' };
  }
}
