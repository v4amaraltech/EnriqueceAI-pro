'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { getAppUrl } from '@/lib/utils/app-url';

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

    // 1. Get SDR's WhatsApp instance (the one creating the group — SDR is auto-added as admin)
    const { data: sdrInstance } = (await from(supabase, 'whatsapp_instances' as never)
      .select('id, instance_name, status')
      .eq('org_id', orgId)
      .eq('user_id', sdrUserId)
      .maybeSingle()) as { data: { id: string; instance_name: string; status: string } | null };

    if (!sdrInstance || sdrInstance.status !== 'connected') {
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

    console.warn(`[whatsapp-group] Creating group: closer=${closerPhoneFormatted} lead=${leadPhoneFormatted} sdr_instance=${sdrInstance.instance_name}`);

    // 4. Create group via Evolution API (create first, then add participants)
    const groupName = `V4 Company <> ${leadCompanyName}`;
    const baseUrl = apiUrl.replace(/\/+$/, '');

    const createResponse = await fetch(
      `${baseUrl}/group/create/${sdrInstance.instance_name}`,
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

    // Try adding participants individually if they weren't added during creation
    if (groupId) {
      for (const participant of participants) {
        try {
          const addResponse = await fetch(
            `${baseUrl}/group/updateParticipant/${sdrInstance.instance_name}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', apikey: apiKey },
              body: JSON.stringify({
                groupJid: groupId,
                action: 'add',
                participants: [participant],
              }),
            },
          );
          if (!addResponse.ok) {
            const errText = await addResponse.text();
            console.warn(`[whatsapp-group] Failed to add ${participant}:`, addResponse.status, errText);
          }
        } catch (addErr) {
          console.warn(`[whatsapp-group] Error adding ${participant}:`, addErr);
        }
      }
    }

    if (!groupId) {
      console.error('[whatsapp-group] No group ID returned');
      return { success: false, error: 'Grupo criado mas ID não retornado' };
    }

    // 5. Set group profile picture (V4 logo)
    //
    // Evolution API spec (doc.evolution-api.com): POST, groupJid is a query
    // parameter, only `image` goes in the JSON body. The previous version
    // used PUT, put groupJid in the body, and ignored response.ok — so every
    // call returned (probably 404/405) without ever applying the picture and
    // without logging anything, since fetch only throws on network errors.
    try {
      const appUrl = getAppUrl();
      const picRes = await fetch(
        `${baseUrl}/group/updateGroupPicture/${sdrInstance.instance_name}?groupJid=${encodeURIComponent(groupId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: apiKey },
          body: JSON.stringify({
            image: `${appUrl}/logos/v4-group-cover.jpeg`,
          }),
        },
      );
      if (!picRes.ok) {
        const errText = await picRes.text().catch(() => '');
        console.warn(`[whatsapp-group] updateGroupPicture failed: ${picRes.status} ${errText.slice(0, 200)}`);
      }
    } catch (picErr) {
      console.warn('[whatsapp-group] Failed to set group picture:', picErr);
    }

    // 6. Send meeting invite message to the group
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
