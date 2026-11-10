import crypto from 'crypto';

import { NextResponse, after } from 'next/server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import {
  createWebhookLogger,
  isEventProcessed,
  markEventReceived,
  processWithRetry,
  verifyHmacSignature,
} from '@/lib/webhooks';
import { captureInboundMessageConsent } from '@/features/contact-engine/services/consent-capture.service';
import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';
import { appendStatusByProviderMessage, storeOrQuarantine } from '@/features/lead-messages/inbound';
import { metaCloudMedia } from '@/features/lead-messages/meta-media';

export const maxDuration = 60;

interface WhatsAppWebhookPayload {
  object: string;
  entry?: {
    changes?: {
      value?: {
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        statuses?: {
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          errors?: { code: number; title: string }[];
        }[];
        messages?: {
          from: string;
          id: string;
          type: string;
          text?: { body: string };
          timestamp: string;
          image?: { id?: string; mime_type?: string };
          audio?: { id?: string; mime_type?: string };
          video?: { id?: string; mime_type?: string };
          document?: { id?: string; mime_type?: string };
          sticker?: { id?: string; mime_type?: string };
        }[];
      };
    }[];
  }[];
}

interface SubEvent {
  eventId: string;
  eventType: string;
  process: (supabase: ReturnType<typeof createServiceRoleClient>) => Promise<void>;
}

const logger = createWebhookLogger('whatsapp');

export async function GET(request: Request) {
  // WhatsApp webhook verification
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  // Timing-safe token comparison (length-guarded — timingSafeEqual throws on
  // mismatched lengths), consistent with the other webhook secret checks.
  const tokenBuf = Buffer.from(token ?? '');
  const verifyBuf = Buffer.from(verifyToken);
  const tokenValid = tokenBuf.length === verifyBuf.length && crypto.timingSafeEqual(tokenBuf, verifyBuf);

  if (mode === 'subscribe' && tokenValid && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  // Verify HMAC signature (required)
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }
  const signature = request.headers.get('x-hub-signature-256');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
  }
  if (!verifyHmacSignature(rawBody, signature, appSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as WhatsAppWebhookPayload;

  if (body.object !== 'whatsapp_business_account') {
    return NextResponse.json({ received: true });
  }

  const supabase = createServiceRoleClient();

  // Collect all sub-events that need processing
  const subEvents: SubEvent[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Delivery status updates
      for (const status of value.statuses ?? []) {
        const statusEventId = `status_${status.id}_${status.status}`;
        if (await isEventProcessed(supabase, 'whatsapp', statusEventId)) continue;

        const typeMap: Record<string, string> = {
          sent: 'sent',
          delivered: 'delivered',
          read: 'opened',
          failed: 'failed',
        };

        const interactionType = typeMap[status.status];
        if (!interactionType) continue;

        subEvents.push({
          eventId: statusEventId,
          eventType: `status.${status.status}`,
          process: async (sb) => {
            await from(sb, 'interactions')
              .update({
                type: interactionType,
                // Only touch metadata when this status carries errors. The old
                // `: null` branch wiped the row's original send context
                // (recipient/template) on the first no-error status callback
                // (sent→delivered→read). Leaving metadata untouched preserves it.
                ...(status.errors ? { metadata: { errors: status.errors } } : {}),
              } as Record<string, unknown>)
              .eq('external_id', status.id);

            const phoneNumberId = value.metadata?.phone_number_id;
            if (phoneNumberId) {
              const { data: statusConnections } = (await from(sb, 'whatsapp_connections')
                .select('org_id')
                .eq('phone_number_id', phoneNumberId)
                .limit(2)) as { data: { org_id: string }[] | null };
              const statusOrg = statusConnections?.length === 1 ? statusConnections[0]?.org_id : null;
              if (statusOrg) {
                await appendStatusByProviderMessage({
                  orgId: statusOrg,
                  providerMessageId: status.id,
                  status: status.status,
                  occurredAt: new Date(Number(status.timestamp) * 1000).toISOString(),
                  raw: status.errors ? { errors: status.errors } : null,
                });
              }
            }

            // Dispatch webhook for sent/failed
            if (status.status === 'sent' || status.status === 'failed') {
              const { data: interaction } = (await from(sb, 'interactions')
                .select('org_id, lead_id')
                .eq('external_id', status.id)
                .maybeSingle()) as { data: { org_id: string; lead_id: string } | null };
              if (interaction) {
                const webhookEvent = status.status === 'sent' ? 'whatsapp.sent' : 'whatsapp.failed';
                dispatchWebhookEvent(sb, interaction.org_id, webhookEvent, {
                  lead_id: interaction.lead_id,
                  whatsapp_message_id: status.id,
                  errors: status.errors ?? null,
                }).catch((err: unknown) => console.error('[whatsapp-webhook] dispatch failed:', err));
              }
            }
          },
        });
      }

      // Incoming messages (reply detection)
      for (const message of value.messages ?? []) {
        const msgEventId = `msg_${message.id}`;
        if (await isEventProcessed(supabase, 'whatsapp', msgEventId)) continue;

        subEvents.push({
          eventId: msgEventId,
          eventType: `message.${message.type}`,
          process: (sb) => processIncomingMessage(sb, message, value.metadata?.phone_number_id ?? null),
        });
      }
    }
  }

  // Mark all sub-events as received before returning response
  for (const sub of subEvents) {
    await markEventReceived(supabase, 'whatsapp', sub.eventId, sub.eventType);
  }

  // Process each sub-event in background with independent retry + DLQ
  if (subEvents.length > 0) {
    after(() =>
      Promise.all(
        subEvents.map((sub) =>
          processWithRetry({
            supabase,
            provider: 'whatsapp',
            eventId: sub.eventId,
            eventType: sub.eventType,
            process: () => sub.process(supabase),
          }),
        ),
      ),
    );
  }

  return NextResponse.json({ received: true });
}

async function processIncomingMessage(
  supabase: ReturnType<typeof createServiceRoleClient>,
  message: {
    from: string;
    id: string;
    type: string;
    text?: { body: string };
    timestamp?: string;
    image?: { id?: string; mime_type?: string };
    audio?: { id?: string; mime_type?: string };
    video?: { id?: string; mime_type?: string };
    document?: { id?: string; mime_type?: string };
    sticker?: { id?: string; mime_type?: string };
  },
  phoneNumberId: string | null,
) {
  // Normalize the incoming phone: Meta sends "55XXXXXXXXXXX"
  const phone = message.from;

  // Find lead by phone — try matching with and without country code
  const phonesToMatch = [phone, `+${phone}`];
  // Also try without country code (55)
  if (phone.startsWith('55') && phone.length >= 12) {
    phonesToMatch.push(phone.slice(2));
  }

  // Pista 18: a org dona do número receptor vem de metadata.phone_number_id via
  // whatsapp_connections. Sem conexão única, NÃO casa lead entre orgs (descarta).
  if (!phoneNumberId) {
    logger.warn('No lead found: payload sem phone_number_id, mensagem ignorada', { message_id: message.id });
    return;
  }
  const { data: connections } = (await from(supabase, 'whatsapp_connections')
    .select('org_id')
    .eq('phone_number_id', phoneNumberId)
    .limit(2)) as { data: { org_id: string }[] | null };
  if (!connections || connections.length !== 1 || !connections[0]) {
    logger.warn('No lead found: phone_number_id sem conexão única, mensagem ignorada', {
      phone_number_id: phoneNumberId,
      connections: connections?.length ?? 0,
    });
    return;
  }
  const connectionOrgId = connections[0].org_id;

  try {
    await storeOrQuarantine({
      db: supabase,
      orgId: connectionOrgId,
      channel: 'whatsapp',
      provider: 'meta',
      phone,
      connectionId: phoneNumberId,
      bodyText: message.text?.body ?? '',
      media: metaCloudMedia(message),
      providerMessageId: message.id,
      direction: 'inbound',
      occurredAt: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : null,
    });
  } catch (err) {
    logger.warn('Captura em lead_messages falhou', { message_id: message.id, error: err instanceof Error ? err.message : String(err) });
  }

  const { data: lead } = (await from(supabase, 'leads')
    .select('id, org_id, nome_fantasia, razao_social, assigned_to')
    .eq('org_id', connectionOrgId)
    .in('telefone', phonesToMatch)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()) as { data: { id: string; org_id: string; nome_fantasia: string | null; razao_social: string | null; assigned_to: string | null } | null };

  if (!lead) {
    logger.warn('No lead found for phone', { phone });
    return;
  }

  // Consentimento (flag consent_capture_v1, por org): mensagem inbound grava opt_in
  // (lead escreveu primeiro) ou opt_out (pedido para parar). Antes do retorno por falta
  // de cadencia: o consentimento nao depende de haver enrollment. Nunca interrompe o fluxo.
  try {
    await captureInboundMessageConsent({
      orgId: lead.org_id,
      leadId: lead.id,
      phone,
      messageId: message.id,
      text: message.text?.body ?? null,
      provider: 'meta_cloud',
    });
  } catch (err) {
    logger.warn('Consent capture failed', { lead_id: lead.id, error: err instanceof Error ? err.message : String(err) });
  }

  // Find active enrollment with whatsapp channel for this lead
  const { data: enrollment } = (await from(supabase, 'cadence_enrollments')
    .select('id, cadence_id, current_step, enrolled_by')
    .eq('lead_id', lead.id)
    .eq('status', 'active')
    .order('enrolled_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as {
    data: { id: string; cadence_id: string; current_step: number; enrolled_by: string | null } | null;
  };

  if (!enrollment) {
    logger.warn('No active enrollment for lead', { lead_id: lead.id });
    return;
  }

  // Find current step to verify it's a whatsapp step
  const { data: step } = (await from(supabase, 'cadence_steps')
    .select('id')
    .eq('cadence_id', enrollment.cadence_id)
    .eq('step_order', enrollment.current_step)
    .eq('channel', 'whatsapp')
    .maybeSingle()) as { data: { id: string } | null };

  const messageText = message.text?.body ?? '';

  // Create interaction for the reply
  await from(supabase, 'interactions').insert({
    org_id: lead.org_id,
    lead_id: lead.id,
    cadence_id: enrollment.cadence_id,
    step_id: step?.id ?? null,
    channel: 'whatsapp',
    type: 'replied',
    message_content: messageText,
    external_id: message.id,
    metadata: { from: phone, message_type: message.type },
  } as Record<string, unknown>);

  // Mark ALL active enrollments of this lead as replied — any reply stops
  // parallel cadences to avoid looking insistent after engagement.
  await from(supabase, 'cadence_enrollments')
    .update({ status: 'replied', completed_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('lead_id', lead.id)
    .eq('status', 'active');

  // Dispatch whatsapp.replied webhook
  dispatchWebhookEvent(supabase, lead.org_id, 'whatsapp.replied', {
    lead_id: lead.id,
    enrollment_id: enrollment.id,
    message_id: message.id,
    message_text: messageText,
  }).catch((err: unknown) => console.error('[whatsapp-webhook] dispatch replied failed:', err));

  // Notify SDR (assigned_to) that lead replied on WhatsApp
  const leadName = lead.nome_fantasia ?? lead.razao_social ?? phone;
  const sdrUserId = lead.assigned_to ?? enrollment.enrolled_by;
  if (sdrUserId) {
    const { createNotification } = await import('@/features/notifications/services/notification.service');
    createNotification({
      org_id: lead.org_id,
      user_id: sdrUserId,
      type: 'whatsapp_reply',
      title: `Resposta WhatsApp: ${leadName}`,
      body: messageText.length > 100 ? messageText.slice(0, 100) + '...' : messageText,
      resource_type: 'lead',
      resource_id: lead.id,
      metadata: { message_id: message.id, from: phone },
    }).catch((err: unknown) => console.error('[whatsapp-webhook] notification failed:', err));
  }

  logger.info('Reply detected', { lead_id: lead.id, enrollment_id: enrollment.id });
}
