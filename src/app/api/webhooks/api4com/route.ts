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
import { TRANSCRIPTION_MIN_DURATION_SECONDS } from '@/features/calls/schemas/call.schemas';
import { computeCallCostBrl } from '@/features/calls/services/call-cost';
import {
  findLeadByPhoneService,
  createExternalCallInteraction,
  advanceExternalCallCadence,
} from '@/features/calls/services/external-call.service';

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

interface MatchedCall {
  id: string;
  status: CallStatus;
  recording_url: string | null;
  metadata: Record<string, unknown> | null;
}

/** Find a matching call record by api4com_call_id or caller+phone fallback.
 *  When matched via fallback, persists the api4com_call_id for future lookups. */
async function findMatchingCall(
  supabase: ReturnType<typeof createServiceRoleClient>,
  body: Api4ComWebhookPayload,
): Promise<MatchedCall | null> {
  // Try by api4com_call_id first
  const { data: call } = (await from(supabase, 'calls')
    .select('id, status, recording_url, metadata')
    .eq('metadata->>api4com_call_id', body.id)
    .maybeSingle()) as { data: MatchedCall | null };

  if (call) return call;

  // Fallback: try matching by caller (ramal) + called (phone) within last 2 hours
  const calledNormalized = body.called.replace(/\D/g, '');
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: fallbackCall } = (await from(supabase, 'calls')
    .select('id, status, recording_url, metadata')
    .eq('origin', body.caller)
    .like('destination', `%${calledNormalized.slice(-8)}`)
    .gte('created_at', twoHoursAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: MatchedCall | null };

  // Persist api4com_call_id so future events match by ID
  if (fallbackCall) {
    const existingMeta = (fallbackCall.metadata ?? {}) as Record<string, unknown>;
    await from(supabase, 'calls')
      .update({ metadata: { ...existingMeta, api4com_call_id: body.id } })
      .eq('id', fallbackCall.id);
    logger.info('Saved api4com_call_id via fallback match', { callId: fallbackCall.id, api4comId: body.id });
  }

  return fallbackCall;
}

/** Auto-create a call record from webhook when no local match exists (e.g. calls from softphone/Kommo) */
async function createCallFromWebhook(
  supabase: ReturnType<typeof createServiceRoleClient>,
  body: Api4ComWebhookPayload,
): Promise<{ call: { id: string } | null; leadId: string | null; userId: string; orgId: string } | null> {
  // Resolve user_id and org_id from the caller ramal
  const { data: conn } = (await from(supabase, 'api4com_connections' as never)
    .select('user_id, org_id')
    .eq('ramal', body.caller)
    .eq('status', 'connected')
    .maybeSingle()) as { data: { user_id: string; org_id: string } | null };

  if (!conn) {
    logger.warn('Cannot auto-create call: no api4com_connection for ramal', { ramal: body.caller });
    return null;
  }

  // Try to find matching lead by destination phone (outbound calls only)
  const isOutbound = body.direction !== 'inbound';
  let leadId: string | null = null;

  if (isOutbound && body.called) {
    const leadMatch = await findLeadByPhoneService(supabase, conn.org_id, body.called);
    leadId = leadMatch?.leadId ?? null;
  }

  const initialDuration = Number(body.duration) || 0;
  const { data: newCall } = (await from(supabase, 'calls')
    .insert({
      org_id: conn.org_id,
      user_id: conn.user_id,
      lead_id: leadId,
      origin: body.caller,
      destination: body.called,
      started_at: body.startedAt || new Date().toISOString(),
      duration_seconds: initialDuration,
      cost: computeCallCostBrl(initialDuration, body.called),
      status: 'not_connected',
      type: isOutbound ? 'outbound' : 'inbound',
      recording_url: body.recordUrl || null,
      metadata: { api4com_call_id: body.id, source: 'external_api4com' },
    })
    .select('id')
    .single()) as { data: { id: string } | null };

  return { call: newCall, leadId, userId: conn.user_id, orgId: conn.org_id };
}

/** Process an API4COM event (runs in background via after()) */
async function processApi4ComEvent(
  body: Api4ComWebhookPayload,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<void> {
  const call = await findMatchingCall(supabase, body);

  if (!call) {
    // No matching call — auto-create from webhook for calls made outside EnriqueceAI
    if (body.eventType === 'channel-hangup') {
      const result = await createCallFromWebhook(supabase, body);
      if (result?.call) {
        logger.info('Auto-created external call', { callId: result.call.id, api4comId: body.id, leadId: result.leadId });
        await updateCallFromWebhook(supabase, result.call.id, 'not_connected', body);

        // Create interaction + advance cadence for outbound calls with matched lead
        if (result.leadId && body.direction !== 'inbound') {
          const duration = Number(body.duration) || 0;
          const status = duration >= 50 ? 'significant' : 'no_contact';

          await createExternalCallInteraction(supabase, {
            orgId: result.orgId,
            leadId: result.leadId,
            userId: result.userId,
            duration,
            api4comId: body.id,
            status,
            recordingUrl: body.recordUrl,
          });

          // Advance cadence if current step is phone
          const leadMatch = await findLeadByPhoneService(supabase, result.orgId, body.called);
          if (leadMatch?.enrollmentId && leadMatch.stepChannel === 'phone') {
            await advanceExternalCallCadence(supabase, {
              enrollmentId: leadMatch.enrollmentId,
              cadenceId: leadMatch.cadenceId!,
              currentStep: leadMatch.currentStep!,
            });
            logger.info('Advanced cadence from external call', { leadId: result.leadId, enrollmentId: leadMatch.enrollmentId });
          }
        }
        return;
      }
    }
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

  // Log incoming request details for debugging
  console.warn(`[api4com-webhook] POST received: url=${webhookUrl.pathname}?${webhookUrl.search} tokenPresent=${!!token} tokenLength=${token.length}`);

  if (!token) {
    // API4COM may strip query params — log and reject
    console.error('[api4com-webhook] No token in request. Full URL:', request.url);
    return NextResponse.json({ error: 'Unauthorized - no token' }, { status: 401 });
  }

  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(webhookSecret);
  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    logger.warn('Invalid webhook secret', { tokenLength: token.length, secretLength: webhookSecret.length });
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

  // Mark as received (pending) before returning response. Passing the body
  // here is what fills webhook_events.payload — without it every API4COM
  // event was being persisted with payload=null, blocking post-mortems.
  await markEventReceived(supabase, 'api4com', compositeEventId, body.eventType, body);

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
    cost: computeCallCostBrl(payload.duration, payload.called),
  };

  // Only update recording_url if webhook provides one (don't overwrite with null)
  if (payload.recordUrl) {
    updates.recording_url = payload.recordUrl;
  }

  // Set started_at from webhook if available
  if (payload.startedAt) {
    updates.started_at = payload.startedAt;
  }

  // Status decision tree — only override if SDR hasn't manually set it
  if (currentStatus === 'not_connected') {
    if (payload.duration >= 50) {
      // Long call = connected and significant
      updates.status = 'significant';
    } else if (payload.hangupCause === 'NORMAL_CLEARING' && !payload.answeredAt) {
      // Rang but not answered
      updates.status = 'no_contact';
    } else {
      // Check hangup cause mapping, fallback to no_contact
      const mappedStatus = hangupCauseToStatus[payload.hangupCause];
      updates.status = mappedStatus ?? 'no_contact';
    }
  }

  await from(supabase, 'calls')
    .update(updates)
    .eq('id', callId);

  // Trigger automatic transcription + SPICED analysis if recording available
  if (payload.recordUrl && payload.duration >= TRANSCRIPTION_MIN_DURATION_SECONDS) {
    triggerTranscription(callId);
  }
}

async function triggerTranscription(callId: string, retries = 2): Promise<void> {
  const appUrl = getAppUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!appUrl || !serviceRoleKey) return;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${appUrl}/api/workers/transcribe-call`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ callId }),
      });
      if (res.ok) return;
      logger.warn('Transcription trigger failed', { callId, attempt, status: res.status });
    } catch (err) {
      logger.warn('Transcription trigger error', { callId, attempt, error: String(err) });
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}
