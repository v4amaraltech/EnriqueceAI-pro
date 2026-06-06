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
import { parseApi4ComTimestamp } from '@/features/integrations/services/api4com-time';
import type { CallStatus } from '@/features/calls/types';
import { TRANSCRIPTION_MIN_DURATION_SECONDS } from '@/features/calls/schemas/call.schemas';
import {
  classifyApi4ComCall,
  getSignificantThreshold,
} from '@/features/calls/services/api4com-classification';
import { computeCallCostBrl } from '@/features/calls/services/call-cost';
import {
  findLeadByPhoneService,
  createExternalCallInteraction,
  advanceExternalCallCadence,
} from '@/features/calls/services/external-call.service';

export const maxDuration = 60;

const logger = createWebhookLogger('api4com');

interface MatchedCall {
  id: string;
  org_id: string;
  status: CallStatus;
  recording_url: string | null;
  metadata: Record<string, unknown> | null;
}

/** Find a matching call record by api4com_call_id, alt_api4com_ids[], or
 *  caller+phone fallback. When matched via fallback or alt match, persists
 *  the new id in alt_api4com_ids[] so future lookups by either id hit. */
async function findMatchingCall(
  supabase: ReturnType<typeof createServiceRoleClient>,
  body: Api4ComWebhookPayload,
): Promise<MatchedCall | null> {
  // 1a) Primary id match
  const { data: call } = (await from(supabase, 'calls')
    .select('id, org_id, status, recording_url, metadata')
    .eq('metadata->>api4com_call_id', body.id)
    .maybeSingle()) as { data: MatchedCall | null };

  if (call) return call;

  // 1b) Secondary id match — API4COM emits 2 different ids for the same
  // call (channel_id vs request_id from /dialer). When the primary holds
  // id A and this event carries id B, the row's metadata.alt_api4com_ids
  // remembers B so future events on either id hit the same row.
  const { data: altMatchCall } = (await from(supabase, 'calls')
    .select('id, org_id, status, recording_url, metadata')
    .contains('metadata', { alt_api4com_ids: [body.id] })
    .maybeSingle()) as { data: MatchedCall | null };

  if (altMatchCall) return altMatchCall;

  // 2) Fallback: caller (ramal) + called (phone) within last 2 hours.
  //
  // Important: only candidates that have NOT already been linked to a
  // previous webhook event. Without this filter, every retry to the
  // same number within 2h collapses onto the first row in the DB —
  // the channel_id gets overwritten on each event and subsequent
  // dialer-created rows for that number stay forever unmatched
  // (we lost 12 calls on 2026-05-14 V4 Amaral this way).
  //
  // Order ASC so the oldest unlinked dialer row wins (first-come,
  // first-served). The webhook_linked marker is set inside the same
  // update below so concurrent webhooks fight over different rows.
  const calledNormalized = body.called.replace(/\D/g, '');
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: fallbackCall } = (await from(supabase, 'calls')
    .select('id, org_id, status, recording_url, metadata')
    .eq('origin', body.caller)
    .like('destination', `%${calledNormalized.slice(-8)}`)
    .gte('created_at', twoHoursAgo)
    .is('metadata->>webhook_linked', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()) as { data: MatchedCall | null };

  // Persist via alt_api4com_ids (don't overwrite primary id). Keeps the
  // primary stable so the dashboard CSV's id (when that's what landed
  // first) remains the authoritative one.
  if (fallbackCall) {
    const existingMeta = (fallbackCall.metadata ?? {}) as Record<string, unknown>;
    const primaryId = existingMeta.api4com_call_id;
    if (primaryId !== body.id) {
      const altIds = Array.isArray(existingMeta.alt_api4com_ids) ? existingMeta.alt_api4com_ids as string[] : [];
      if (!altIds.includes(body.id)) {
        await from(supabase, 'calls')
          .update({
            metadata: {
              ...existingMeta,
              alt_api4com_ids: [...altIds, body.id],
              webhook_linked: true,
            },
          })
          .eq('id', fallbackCall.id);
        logger.info('Saved alt api4com_call_id via fallback match', { callId: fallbackCall.id, api4comId: body.id });
      }
    } else {
      // Same primary id (rare with this path — only happens if metadata
      // was wiped). Just flip webhook_linked.
      await from(supabase, 'calls')
        .update({
          metadata: { ...existingMeta, webhook_linked: true },
        })
        .eq('id', fallbackCall.id);
    }
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
    const leadMatch = await findLeadByPhoneService(supabase, conn.org_id, body.called, conn.user_id);
    leadId = leadMatch?.leadId ?? null;
  }

  const initialDuration = Number(body.duration) || 0;
  // Apply the same classifier used by updateCallFromWebhook so an auto-created
  // call is created already with the right connected/status — otherwise we'd
  // insert with status='not_connected' and rely on a follow-up update to fix
  // it, which is racy.
  const threshold = await getSignificantThreshold(supabase, conn.org_id);
  const classification = classifyApi4ComCall({
    answeredAt: body.answeredAt,
    hangupCause: body.hangupCause ?? null,
    durationSeconds: initialDuration,
    significantThresholdSeconds: threshold,
  });
  const answeredAtIso = parseApi4ComTimestamp(body.answeredAt)?.toISOString() ?? null;

  const { data: newCall } = (await from(supabase, 'calls')
    .insert({
      org_id: conn.org_id,
      user_id: conn.user_id,
      lead_id: leadId,
      origin: body.caller,
      destination: body.called,
      started_at: parseApi4ComTimestamp(body.startedAt)?.toISOString() ?? new Date().toISOString(),
      answered_at: answeredAtIso,
      duration_seconds: initialDuration,
      cost: computeCallCostBrl(initialDuration, body.called),
      status: classification.status,
      connected: classification.connected,
      hangup_cause: body.hangupCause ?? null,
      type: isOutbound ? 'outbound' : 'inbound',
      recording_url: body.recordUrl || null,
      metadata: { api4com_call_id: body.id, source: 'external_api4com', webhook_linked: true },
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

        // Persist the recording to our Storage while the listener link is alive.
        if (body.recordUrl) triggerPersistRecording(result.call.id);
        // createCallFromWebhook already applied the classifier — no need to
        // re-run updateCallFromWebhook (was a stale "fix up after default
        // insert" left over from the old not_connected default).

        // Create interaction + advance cadence for outbound calls with matched lead
        if (result.leadId && body.direction !== 'inbound') {
          const duration = Number(body.duration) || 0;
          // Use the same authoritative classification used when inserting the
          // call row — interaction status was previously a hardcoded
          // duration>=50 heuristic that diverged from the call row.
          const threshold = await getSignificantThreshold(supabase, result.orgId);
          const interactionClass = classifyApi4ComCall({
            answeredAt: body.answeredAt,
            hangupCause: body.hangupCause ?? null,
            durationSeconds: duration,
            significantThresholdSeconds: threshold,
          });
          const status = interactionClass.connected ? 'significant' : 'no_contact';

          await createExternalCallInteraction(supabase, {
            orgId: result.orgId,
            leadId: result.leadId,
            userId: result.userId,
            duration,
            api4comId: body.id,
            status,
            recordingUrl: body.recordUrl,
            callId: result.call.id,
          });

          // Advance cadence if current step is phone
          const leadMatch = await findLeadByPhoneService(supabase, result.orgId, body.called, result.userId);
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
    // channel-answer: this event itself proves the call was answered, so we
    // can flip connected=true and answered_at immediately — before
    // channel-hangup arrives. The dashboard SH stops underreporting even if
    // hangup never fires (lost webhook, killed process, etc).
    const updates: Record<string, unknown> = { connected: true };
    if (body.answeredAt) {
      updates.answered_at = parseApi4ComTimestamp(body.answeredAt)?.toISOString() ?? null;
    }
    if (body.recordUrl && !call.recording_url) {
      updates.recording_url = body.recordUrl;
    }
    const startedIso = parseApi4ComTimestamp(body.startedAt)?.toISOString();
    if (startedIso) {
      updates.started_at = startedIso;
    }
    await from(supabase, 'calls').update(updates).eq('id', call.id);
    if (body.recordUrl) triggerPersistRecording(call.id);
    logger.info('Call updated from channel-answer', {
      callId: call.id,
      api4comId: body.id,
      hasRecording: !!body.recordUrl,
    });
    return;
  }

  // channel-hangup: full update
  await updateCallFromWebhook(supabase, call.id, call.status, body, call.org_id);
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
  orgId: string,
) {
  const updates: Record<string, unknown> = {
    duration_seconds: payload.duration,
    cost: computeCallCostBrl(payload.duration, payload.called),
    hangup_cause: payload.hangupCause ?? null,
  };

  // Only update recording_url if webhook provides one (don't overwrite with null)
  if (payload.recordUrl) {
    updates.recording_url = payload.recordUrl;
  }

  // Set started_at from webhook if available — parseApi4ComTimestamp
  // converts the BRT-without-timezone shape to real UTC.
  const startedAtUtc = parseApi4ComTimestamp(payload.startedAt)?.toISOString();
  if (startedAtUtc) {
    updates.started_at = startedAtUtc;
  }

  const answeredAtUtc = parseApi4ComTimestamp(payload.answeredAt)?.toISOString() ?? null;
  if (answeredAtUtc) {
    updates.answered_at = answeredAtUtc;
  }

  // Only override status/connected if SDR hasn't manually classified yet.
  // Once a manager/SDR moved the call out of 'not_connected', their judgment
  // wins — webhook retries arriving days later won't downgrade it.
  if (currentStatus === 'not_connected') {
    const threshold = await getSignificantThreshold(supabase, orgId);
    const classification = classifyApi4ComCall({
      answeredAt: payload.answeredAt,
      hangupCause: payload.hangupCause ?? null,
      durationSeconds: payload.duration,
      significantThresholdSeconds: threshold,
    });
    updates.status = classification.status;
    updates.connected = classification.connected;
  }

  await from(supabase, 'calls')
    .update(updates)
    .eq('id', callId);

  // Persist the recording to our Storage (any duration) before the listener
  // link expires — independent of the transcription minimum below.
  if (payload.recordUrl) {
    triggerPersistRecording(callId);
  }

  // Trigger automatic transcription + SPICED analysis if recording available
  if (payload.recordUrl && payload.duration >= TRANSCRIPTION_MIN_DURATION_SECONDS) {
    triggerTranscription(callId);
  }
}

/** Fire-and-forget: download + persist the recording to our Storage bucket so
 *  it stays playable after API4COM's listener link expires. Idempotent. */
function triggerPersistRecording(callId: string): void {
  const appUrl = getAppUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!appUrl || !serviceRoleKey) return;

  fetch(`${appUrl}/api/workers/persist-recording`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ callId }),
  }).catch((err) => logger.warn('Persist-recording trigger error', { callId, error: String(err) }));
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
