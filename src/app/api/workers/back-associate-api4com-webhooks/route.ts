import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export const maxDuration = 300;

const JOB_NAME = 'back-associate-api4com-webhooks';

// The id we save in calls.metadata.api4com_call_id (from POST /dialer
// response) does not match the id that arrives in the channel-hangup
// webhook payload. As a result findMatchingCall fails the id lookup
// and falls back to origin+destination matching from inside the webhook
// handler itself — which only covers about 60% of the day. The other
// 40% stay as not_connected forever, even when they were real
// conversations of several minutes.
//
// This worker does the same origin+destination correlation
// retroactively over webhook_events rows that didn't match a call yet,
// applies the correct status based on hangupCause/duration, and writes
// the api4com_call_id into the call's metadata so future events
// (recording URL backfill, etc.) match by id.

interface WebhookRow {
  id: string;
  event_id: string;
  payload: Api4ComHangupPayload;
}

interface Api4ComHangupPayload {
  id: string;
  caller: string;
  called: string;
  startedAt?: string;
  answeredAt?: string;
  duration?: number | string;
  hangupCause?: string;
  recordUrl?: string;
  direction?: string;
}

interface CallRow {
  id: string;
  status: string;
  recording_url: string | null;
  metadata: Record<string, unknown> | null;
  org_id: string;
}

interface OrgResult {
  org_id: string;
  matched: number;
  ambiguous: number;
  unmatched: number;
  status_updated: number;
}

const hangupCauseToStatus: Record<string, string> = {
  NO_ANSWER: 'no_contact',
  NO_USER_RESPONSE: 'no_contact',
  USER_BUSY: 'busy',
  CALL_REJECTED: 'not_connected',
  UNALLOCATED_NUMBER: 'not_connected',
  INVALID_NUMBER_FORMAT: 'not_connected',
  ORIGINATOR_CANCEL: 'not_connected',
  NORMAL_TEMPORARY_FAILURE: 'not_connected',
  RECOVERY_ON_TIMER_EXPIRE: 'not_connected',
};

function deriveStatus(payload: Api4ComHangupPayload, durationSeconds: number): string {
  if (durationSeconds >= 50) return 'significant';
  if (payload.hangupCause === 'NORMAL_CLEARING' && !payload.answeredAt) return 'no_contact';
  return hangupCauseToStatus[payload.hangupCause ?? ''] ?? 'no_contact';
}

async function handle(request: Request) {
  if (!verifyServiceRole(request) && !verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    sinceHours?: number;
    dryRun?: boolean;
    maxEvents?: number;
  };

  const sinceHours = Math.min(Math.max(body.sinceHours ?? 24, 1), 720);
  const dryRun = body.dryRun === true;
  const maxEvents = Math.min(Math.max(body.maxEvents ?? 500, 1), 5000);

  const supabase = createServiceRoleClient();
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  // 1. Pull recent channel-hangup webhooks
  const { data: events } = (await from(supabase, 'webhook_events')
    .select('id, event_id, payload')
    .eq('provider', 'api4com')
    .eq('event_type', 'channel-hangup')
    .gte('processed_at', since)
    .order('processed_at', { ascending: false })
    .limit(maxEvents)) as { data: WebhookRow[] | null };

  if (!events || events.length === 0) {
    return NextResponse.json({ job: JOB_NAME, sinceHours, processed: 0, results: [] });
  }

  // 2. For each event, try to find a single matching call by ramal + dest
  //    + time window (±5 min around startedAt). Skip events whose payload.id
  //    already lives in some call.metadata.api4com_call_id.
  const perOrg = new Map<string, OrgResult>();
  let totalMatched = 0;
  let totalAmbiguous = 0;
  let totalUnmatched = 0;
  let totalStatusUpdated = 0;

  for (const ev of events) {
    const p = ev.payload;
    if (!p?.id || !p.caller || !p.called || !p.startedAt) {
      totalUnmatched++;
      continue;
    }

    // Skip if this webhook id is already linked to a call
    const { data: alreadyLinked } = (await from(supabase, 'calls')
      .select('id')
      .eq('metadata->>api4com_call_id', p.id)
      .limit(1)
      .maybeSingle()) as { data: { id: string } | null };
    if (alreadyLinked) continue;

    // Match window: started_at ±5 min, origin=caller, destination ends
    // with last 8 digits of called
    const calledDigits = p.called.replace(/\D/g, '');
    const suffix = calledDigits.slice(-8);
    const startedAt = new Date(p.startedAt);
    if (Number.isNaN(startedAt.getTime())) {
      totalUnmatched++;
      continue;
    }
    const lo = new Date(startedAt.getTime() - 5 * 60 * 1000).toISOString();
    const hi = new Date(startedAt.getTime() + 5 * 60 * 1000).toISOString();

    const { data: candidates } = (await from(supabase, 'calls')
      .select('id, status, recording_url, metadata, org_id')
      .eq('origin', p.caller)
      .like('destination', `%${suffix}`)
      .gte('started_at', lo)
      .lte('started_at', hi)
      .is('metadata->>api4com_call_id', null)
      .limit(3)) as { data: CallRow[] | null };

    const matches = candidates ?? [];

    if (matches.length === 0) {
      totalUnmatched++;
      continue;
    }
    if (matches.length > 1) {
      // Don't guess — log for diagnostic, leave unlinked
      totalAmbiguous++;
      continue;
    }

    const call = matches[0]!;
    const orgRes = perOrg.get(call.org_id) ?? {
      org_id: call.org_id,
      matched: 0,
      ambiguous: 0,
      unmatched: 0,
      status_updated: 0,
    };

    // Build the update: always set api4com_call_id; update status only if
    // it's still the initial 'not_connected' (don't overwrite manual SDR
    // classification)
    const durationSeconds = Number(p.duration ?? 0) || 0;
    const newStatus = deriveStatus(p, durationSeconds);
    const meta = (call.metadata ?? {}) as Record<string, unknown>;
    const newMeta = { ...meta, api4com_call_id: p.id, back_associated_at: new Date().toISOString() };

    const updates: Record<string, unknown> = {
      metadata: newMeta,
      duration_seconds: durationSeconds,
    };
    if (p.recordUrl && !call.recording_url) {
      updates.recording_url = p.recordUrl;
    }
    if (call.status === 'not_connected') {
      updates.status = newStatus;
      orgRes.status_updated++;
      totalStatusUpdated++;
    }

    if (!dryRun) {
      await from(supabase, 'calls').update(updates).eq('id', call.id);
    }

    orgRes.matched++;
    totalMatched++;
    perOrg.set(call.org_id, orgRes);
  }

  totalAmbiguous += 0; // already counted inline
  totalUnmatched += 0;

  return NextResponse.json({
    job: JOB_NAME,
    sinceHours,
    dryRun,
    processed: events.length,
    matched: totalMatched,
    ambiguous: totalAmbiguous,
    unmatched: totalUnmatched,
    status_updated: totalStatusUpdated,
    per_org: Array.from(perOrg.values()),
    checked_at: new Date().toISOString(),
  });
}

export const POST = handle;
export const GET = handle;
