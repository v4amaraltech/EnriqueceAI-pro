import { NextResponse } from 'next/server';

import { processCallTranscription } from '@/features/calls/services/transcription.service';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';

// Allow up to 5 minutes for transcription + SPICED analysis
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!verifyServiceRole(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as { callId?: string };

  if (!body.callId) {
    return NextResponse.json({ error: 'callId required' }, { status: 400 });
  }

  try {
    await processCallTranscription(body.callId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[worker/transcribe-call] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
