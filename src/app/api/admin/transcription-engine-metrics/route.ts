import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { fetchDailyMetrics } from '@/features/calls/services/transcription-engine/monitoring';

/** Métricas diárias do motor (somente leitura, sem texto). GET ?orgId=<uuid>&days=14 */
export async function GET(request: Request) {
  if (!verifyServiceRole(request) && !verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const orgId = url.searchParams.get('orgId');
  if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) {
    return NextResponse.json({ error: 'orgId required' }, { status: 400 });
  }
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 14));
  const rows = await fetchDailyMetrics(createServiceRoleClient(), orgId, days);
  return NextResponse.json({ rows });
}
