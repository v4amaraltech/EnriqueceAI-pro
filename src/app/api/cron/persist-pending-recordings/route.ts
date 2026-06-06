import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { persistCallRecording } from '@/features/calls/services/recording-storage.service';

export const maxDuration = 300;

// Calls whose recording lives only on API4COM (ephemeral listener URL that
// expires in hours). Persist them to our Storage so the player keeps working.
// Newest/oldest split mirrors recover-missing-recordings so a deep backlog
// doesn't starve the oldest items still inside API4COM's ~90d retention.
const BATCH_LIMIT_NEW = 25;
const BATCH_LIMIT_OLD = 25;
// Beyond ~90d the durable file is gone from API4COM (and dead listener URLs
// can't be re-resolved), so persistence would just fail — cap to stay useful.
const MAX_AGE_DAYS = 60;

/**
 * Backfill: download recordings that have a recording_url but were never
 * persisted to our Storage bucket (recording_storage_path IS NULL), in batches.
 * persistCallRecording re-resolves a durable URL via the API4COM API when the
 * stored listener link has already expired. Forward calls are persisted by the
 * webhook; this drains the historical backlog and self-heals any misses.
 */
export async function POST(request: Request) {
  if (!verifyServiceRole(request) && !verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const cutoffIso = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  type CallRow = { id: string; created_at: string };

  const baseQuery = () =>
    from(supabase, 'calls')
      .select('id, created_at')
      .is('recording_storage_path', null)
      .not('recording_url', 'is', null)
      .gt('duration_seconds', 0)
      .gte('created_at', cutoffIso);

  const results = (await Promise.all([
    baseQuery().order('created_at', { ascending: false }).limit(BATCH_LIMIT_NEW),
    baseQuery().order('created_at', { ascending: true }).limit(BATCH_LIMIT_OLD),
  ])) as unknown as Array<{ data: CallRow[] | null }>;

  const seen = new Set<string>();
  const calls: CallRow[] = [];
  for (const row of [...(results[0]?.data ?? []), ...(results[1]?.data ?? [])]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    calls.push(row);
  }

  if (calls.length === 0) {
    return NextResponse.json({ message: 'No recordings pending persistence', processed: 0 });
  }

  let persisted = 0;
  let noAudio = 0;
  let failed = 0;

  for (const call of calls) {
    try {
      const result = await persistCallRecording(supabase, call.id);
      if (result.ok) persisted++;
      else noAudio++;
    } catch (err) {
      failed++;
      console.error('[persist-pending-recordings] error processing call', call.id, err);
    }
  }

  return NextResponse.json({
    message: 'Recording persistence batch processed',
    total: calls.length,
    persisted,
    noAudio,
    failed,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
