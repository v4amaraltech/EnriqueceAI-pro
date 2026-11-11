import { NextResponse } from 'next/server';

import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { processEngineCall } from '@/features/calls/services/transcription-engine/orchestrator';

// Download + transcrição AssemblyAI (polling) + JEV.
export const maxDuration = 300;

/** Worker do motor paralelo. Separado do transcribe-call (whisper). Flag off = no-op. */
export async function POST(request: Request) {
  if (!verifyServiceRole(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { callId?: string };
  if (!body.callId) {
    return NextResponse.json({ error: 'callId required' }, { status: 400 });
  }
  try {
    const outcome = await processEngineCall(body.callId);
    return NextResponse.json({ success: true, outcome });
  } catch (err) {
    console.error('[worker/transcribe-qualify-call] Error:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
