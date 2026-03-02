import { NextResponse, after } from 'next/server';

import { createServiceRoleClient } from '@/lib/supabase/service';
import {
  createWebhookLogger,
  isEventProcessed,
  markEventReceived,
  processWithRetry,
  verifyHmacSignature,
} from '@/lib/webhooks';

export const maxDuration = 60;

interface WhatsAppWebhookPayload {
  object: string;
  entry?: {
    changes?: {
      value?: {
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

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  // Verify signature if app secret is configured
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret) {
    const signature = request.headers.get('x-hub-signature-256');
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    if (!verifyHmacSignature(rawBody, signature, appSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
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
            await (sb.from('interactions') as ReturnType<typeof sb.from>)
              .update({
                type: interactionType,
                metadata: status.errors ? { errors: status.errors } : null,
              } as Record<string, unknown>)
              .eq('external_id', status.id);
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
          process: (sb) => processIncomingMessage(sb, message),
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
  message: { from: string; id: string; type: string; text?: { body: string } },
) {
  // Normalize the incoming phone: Meta sends "55XXXXXXXXXXX"
  const phone = message.from;

  // Find lead by phone — try matching with and without country code
  const phonesToMatch = [phone, `+${phone}`];
  // Also try without country code (55)
  if (phone.startsWith('55') && phone.length >= 12) {
    phonesToMatch.push(phone.slice(2));
  }

  const { data: lead } = (await (
    supabase.from('leads') as ReturnType<typeof supabase.from>
  )
    .select('id, org_id')
    .in('telefone', phonesToMatch)
    .limit(1)
    .maybeSingle()) as { data: { id: string; org_id: string } | null };

  if (!lead) {
    logger.warn('No lead found for phone', { phone });
    return;
  }

  // Find active enrollment with whatsapp channel for this lead
  const { data: enrollment } = (await (
    supabase.from('cadence_enrollments') as ReturnType<typeof supabase.from>
  )
    .select('id, cadence_id, current_step')
    .eq('lead_id', lead.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as {
    data: { id: string; cadence_id: string; current_step: number } | null;
  };

  if (!enrollment) {
    logger.warn('No active enrollment for lead', { lead_id: lead.id });
    return;
  }

  // Find current step to verify it's a whatsapp step
  const { data: step } = (await (
    supabase.from('cadence_steps') as ReturnType<typeof supabase.from>
  )
    .select('id')
    .eq('cadence_id', enrollment.cadence_id)
    .eq('step_order', enrollment.current_step)
    .eq('channel', 'whatsapp')
    .maybeSingle()) as { data: { id: string } | null };

  const messageText = message.text?.body ?? '';

  // Create interaction for the reply
  await (supabase.from('interactions') as ReturnType<typeof supabase.from>).insert({
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

  // Mark enrollment as replied
  await (supabase.from('cadence_enrollments') as ReturnType<typeof supabase.from>)
    .update({ status: 'replied' } as Record<string, unknown>)
    .eq('id', enrollment.id);

  logger.info('Reply detected', { lead_id: lead.id, enrollment_id: enrollment.id });
}
