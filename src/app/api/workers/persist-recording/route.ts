import { NextResponse } from 'next/server';

import { persistCallRecording } from '@/features/calls/services/recording-storage.service';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { createServiceRoleClient } from '@/lib/supabase/service';

// Downloading + uploading a long recording can take a while.
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!verifyServiceRole(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as { callId?: string; force?: boolean };

  if (!body.callId) {
    return NextResponse.json({ error: 'callId required' }, { status: 400 });
  }

  try {
    const supabase = createServiceRoleClient();
    const result = await persistCallRecording(supabase, body.callId, { force: body.force });
    if (!result.ok) {
      console.warn('[worker/persist-recording] not persisted:', body.callId, result.reason);
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('[worker/persist-recording] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
