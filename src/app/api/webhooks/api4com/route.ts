import crypto from 'crypto';

import { NextResponse, after } from 'next/server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { getAppUrl } from '@/lib/utils/app-url';
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

/** Find a matching call record by api4com_call_id or caller+phone fallback */
async function findMatchingCall(
  supabase: ReturnType<typeof createServiceRoleClient>,
  body: Api4ComWebhookPayload,
): Promise<{ id: string; status: CallStatus; recording_url: string | null } | null> {
  // Try by api4com_call_id first
  const { data: call } = (await from(supabase, 'calls')
    .select('id, status, recording_url')
    .eq('metadata->>api4com_call_id', body.id)
    .maybeSingle()) as { data: { id: string; status: CallStatus; recording_url: string | null } | null };

  if (call) return call;

  // Fallback: try matching by caller (ramal) + called (phone)
  const calledNormalized = body.called.replace(/\D/g, '');
  const { data: fallbackCall } = (await from(supabase, 'calls')
    .select('id, status, recording_url')
    .eq('origin', body.caller)
    .like('destination', `%${calledNormalized.slice(-8)}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { id: string; status: CallStatus; recording_url: string | null } | null };

  return fallbackCall;
}

/** Process an API4COM event (runs in background via after()) */
async function processApi4ComEvent(
  body: Api4ComWebhookPayload,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<void> {
  const call = await findMatchingCall(supabase, body);

  if (!call) {
    logger.warn('No matching call found', {
      api4comId: body.id,
      caller: body.caller,
      called: body.called,
      eventType: body.eventType,
    });
    return;
  }

  if (body.eventType === 'channel-answer') {
    // channel-answer: save recordUrl early if available
    const updates: Record<string, unknown> = {};
    if (body.recordUrl && !call.recording_url) {
      updates.recording_url = body.recordUrl;
    }
    if (body.startedAt) {
      updates.started_at = body.startedAt;
    }
    if (Object.keys(updates).length > 0) {
      await from(supabase, 'calls').update(updates).eq('id', call.id);
      logger.info('Call updated from channel-answer', {
        callId: call.id,
        api4comId: body.id,
        hasRecording: !!body.recordUrl,
      });
    }
    return;
  }

  // channel-hangup: full update
  await updateCallFromWebhook(supabase, call.id, call.status, body);
  logger.info('Call updated', { callId: call.id, api4comId: body.id });
}

// GET handler for health check / connectivity test
export async function GET(request: Request) {
  const webhookUrl = new URL(request.url);
  const token = webhookUrl.searchParams.get('token') ?? '';
  const webhookSecret = process.env.API4COM_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json({ status: 'error', message: 'API4COM_WEBHOOK_SECRET not configured' }, { status: 503 });
  }

  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(webhookSecret);
  const tokenValid = tokenBuf.length === secretBuf.length && crypto.timingSafeEqual(tokenBuf, secretBuf);

  return NextResponse.json({
    status: 'ok',
    tokenValid,
    tokenLength: token.length,
    secretLength: webhookSecret.length,
    timestamp: new Date().toISOString(),
  });
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

  if (body.eventType !== 'channel-hangup' && body.eventType !== 'channel-answer') {
    logger.info('Ignoring event', { eventType: body.eventType });
    return NextResponse.json({ received: true });
  }

  const supabase = createServiceRoleClient();

  // Use composite event ID to allow both channel-answer and channel-hangup for same call
  const compositeEventId = `${body.id}:${body.eventType}`;

  // Idempotency check
  if (await isEventProcessed(supabase, 'api4com', compositeEventId)) {
    logger.info('Event already processed', { id: body.id, eventType: body.eventType });
    return NextResponse.json({ received: true });
  }

  // Mark as received (pending) before returning response
  await markEventReceived(supabase, 'api4com', compositeEventId, body.eventType);

  // Process in background after response is sent
  after(() =>
    processWithRetry({
      supabase,
      provider: 'api4com',
      eventId: compositeEventId,
      eventType: body.eventType,
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
  };

  // Only update recording_url if webhook provides one (don't overwrite with null)
  if (payload.recordUrl) {
    updates.recording_url = payload.recordUrl;
  }

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

  // Trigger automatic transcription + SPICED analysis if recording available
  if (payload.recordUrl && payload.duration >= 30) {
    const appUrl = getAppUrl();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (appUrl && serviceRoleKey) {
      fetch(`${appUrl}/api/workers/transcribe-call`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ callId }),
      }).catch((err) => {
        logger.warn('Failed to trigger transcription worker', { callId, error: String(err) });
      });
    }
  }
}
