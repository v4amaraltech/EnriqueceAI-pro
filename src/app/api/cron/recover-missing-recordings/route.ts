import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { getAppUrl } from '@/lib/utils/app-url';
import { lookupRecordingFromApi4Com } from '@/features/calls/services/recover-recording.service';
import { TRANSCRIPTION_MIN_DURATION_SECONDS } from '@/features/calls/schemas/call.schemas';

export const maxDuration = 300;
const BATCH_LIMIT = 20;
const MAX_AGE_DAYS = 45; // API4COM keeps records ~90d; cap at 45 to stay safely within window

/**
 * Catches calls where API4COM's channel-hangup webhook fired before the recording
 * was ready. The webhook delivers recordUrl in only ~14% of cases for this org,
 * so the rest fall back to this cron, which queries the API4COM REST API directly.
 *
 * Pairs with /api/cron/process-pending-transcriptions: once recording_url is set,
 * that cron picks the call up and runs Whisper + SPICED.
 */
export async function POST(request: Request) {
  if (!verifyServiceRole(request) && !verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const cutoffIso = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: pending } = (await from(supabase, 'calls')
    .select('id, destination, origin, started_at, created_at, duration_seconds, user_id, org_id, metadata')
    .is('recording_url', null)
    .gte('duration_seconds', TRANSCRIPTION_MIN_DURATION_SECONDS)
    .gte('created_at', cutoffIso)
    .order('created_at', { ascending: false })
    .limit(BATCH_LIMIT)) as {
    data: Array<{
      id: string;
      destination: string;
      origin: string | null;
      started_at: string | null;
      created_at: string;
      duration_seconds: number;
      user_id: string;
      org_id: string;
      metadata: Record<string, string> | null;
    }> | null;
  };

  const calls = pending ?? [];
  if (calls.length === 0) {
    return NextResponse.json({ message: 'No calls awaiting recording recovery', processed: 0 });
  }

  let recovered = 0;
  let notFound = 0;
  let failed = 0;

  for (const call of calls) {
    try {
      const recordingUrl = await lookupRecordingFromApi4Com(supabase, call);

      if (!recordingUrl) {
        notFound++;
        continue;
      }

      await from(supabase, 'calls')
        .update({ recording_url: recordingUrl, updated_at: new Date().toISOString() })
        .eq('id', call.id);

      // Trigger transcription worker (fire-and-forget)
      const appUrl = getAppUrl();
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (appUrl && serviceRoleKey) {
        fetch(`${appUrl}/api/workers/transcribe-call`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ callId: call.id }),
        }).catch((err) => console.error('[recover-recordings] transcription trigger failed', call.id, err));
      }

      recovered++;
    } catch (err) {
      failed++;
      console.error('[recover-recordings] error processing call', call.id, err);
    }
  }

  return NextResponse.json({
    message: 'Recording recovery batch processed',
    total: calls.length,
    recovered,
    notFound,
    failed,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
