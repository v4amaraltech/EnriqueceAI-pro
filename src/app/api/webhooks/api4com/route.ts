import crypto from 'crypto';

import { NextResponse, after } from 'next/server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import {
  createWebhookLogger,
  isEventProcessed,
  markEventReceived,
  processWithRetry,
} from '@/lib/webhooks';

import type { Api4ComWebhookPayload } from '@/features/integrations/types/api4com';
import type { CallStatus } from '@/features/calls/types';

export const maxDuration = 60;

const logger = createWebhookLogger('api4com');

// Map FreeSWITCH hangup causes to our CallStatus
const hangupCauseToStatus: Record<string, CallStatus> = {
  NO_ANSWER: 'no_contact',
  NO_USER_RESPONSE: 'no_contact',
  USER_BUSY: 'busy',
  CALL_REJECTED: 'not_connected',
  UNALLOCATED_NUMBER: 'not_connected',
  INVALID_NUMBER_FORMAT: 'not_connected',
  ORIGINATOR_CANCEL: 'not_connected',
  NORMAL_TEMPORARY_FAILURE: 'not_connected',
  RECOVERY_ON_TIMER_EXPIRE: 'not_connected',
  // NORMAL_CLEARING handled separately below (depends on answeredAt)
};

/** Process an API4COM event (runs in background via after()) */
async function processApi4ComEvent(
  body: Api4ComWebhookPayload,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<void> {
  // Correlate with our calls table via metadata->api4com_call_id
  const { data: call } = (await from(supabase, 'calls')
    .select('id, status')
    .eq('metadata->>api4com_call_id', body.id)
    .maybeSingle()) as { data: { id: string; status: CallStatus } | null };

  if (!call) {
    // Fallback: try matching by caller (ramal) + called (phone)
    const calledNormalized = body.called.replace(/\D/g, '');
    const { data: fallbackCall } = (await from(supabase, 'calls')
      .select('id, status')
      .eq('origin', body.caller)
      .like('destination', `%${calledNormalized.slice(-8)}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: { id: string; status: CallStatus } | null };

    if (!fallbackCall) {
      logger.warn('No matching call found', {
        api4comId: body.id,
        caller: body.caller,
        called: body.called,
      });
      return;
    }

    await updateCallFromWebhook(supabase, fallbackCall.id, fallbackCall.status, body);
    logger.info('Call updated via fallback', { callId: fallbackCall.id, api4comId: body.id });
    return;
  }

  await updateCallFromWebhook(supabase, call.id, call.status, body);
  logger.info('Call updated', { callId: call.id, api4comId: body.id });
}

export async function POST(request: Request) {
  // Verify webhook secret (passed as query param or header)
  const webhookSecret = process.env.API4COM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.warn('API4COM_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }
  const webhookUrl = new URL(request.url);
  const token = webhookUrl.searchParams.get('token') ?? request.headers.get('x-webhook-secret') ?? '';
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(webhookSecret);
  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    logger.warn('Invalid webhook secret');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawBody = await request.text();

  let body: Api4ComWebhookPayload;
  try {
    body = JSON.parse(rawBody) as Api4ComWebhookPayload;
  } catch {
    logger.warn('Invalid JSON body');
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.eventType !== 'channel-hangup') {
    logger.info('Ignoring non-hangup event', { eventType: body.eventType });
    return NextResponse.json({ received: true });
  }

  const supabase = createServiceRoleClient();

  // Idempotency check
  if (await isEventProcessed(supabase, 'api4com', body.id)) {
    logger.info('Event already processed', { id: body.id });
    return NextResponse.json({ received: true });
  }

  // Mark as received (pending) before returning response
  await markEventReceived(supabase, 'api4com', body.id, 'channel-hangup');

  // Process in background after response is sent
  after(() =>
    processWithRetry({
      supabase,
      provider: 'api4com',
      eventId: body.id,
      eventType: 'channel-hangup',
      process: () => processApi4ComEvent(body, supabase),
    }),
  );

  return NextResponse.json({ received: true });
}

async function updateCallFromWebhook(
  supabase: ReturnType<typeof createServiceRoleClient>,
  callId: string,
  currentStatus: CallStatus,
  payload: Api4ComWebhookPayload,
) {
  const updates: Record<string, unknown> = {
    duration_seconds: payload.duration,
    recording_url: payload.recordUrl || null,
  };

  // Set started_at from webhook if available
  if (payload.startedAt) {
    updates.started_at = payload.startedAt;
  }

  // Only override status if hangup cause maps to a specific status
  // and the current status hasn't been manually set by the SDR
  const mappedStatus = hangupCauseToStatus[payload.hangupCause];
  if (mappedStatus && currentStatus === 'not_connected') {
    updates.status = mappedStatus;
  }

  // If the call was answered and has duration, it was connected
  if (payload.answeredAt && payload.duration > 0 && currentStatus === 'not_connected') {
    updates.status = 'significant';
  }

  // NORMAL_CLEARING without answeredAt means it rang but was not answered
  if (payload.hangupCause === 'NORMAL_CLEARING' && !payload.answeredAt && currentStatus === 'not_connected') {
    updates.status = 'no_contact';
  }

  await from(supabase, 'calls')
    .update(updates)
    .eq('id', callId);
}
