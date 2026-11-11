import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { findDrainCandidates, processEngineCall } from '@/features/calls/services/transcription-engine/orchestrator';

export const maxDuration = 300;
const BATCH_LIMIT = 5;

/**
 * Drena pendentes/falhas do motor paralelo (retry até MAX_ATTEMPTS).
 * NÃO está no vercel.json. Chamada manual:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/process-pending-transcription-engine
 * Cada ligação respeita a flag da própria org (flag off = no-op).
 */
export async function POST(request: Request) {
  if (!verifyServiceRole(request) && !verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const ids = await findDrainCandidates(createServiceRoleClient(), BATCH_LIMIT);
  const outcomes: Record<string, number> = {};
  for (const id of ids) {
    let outcome: string;
    try {
      outcome = await processEngineCall(id);
    } catch {
      outcome = 'error';
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return NextResponse.json({ total: ids.length, outcomes });
}

export async function GET(request: Request) {
  return POST(request);
}
