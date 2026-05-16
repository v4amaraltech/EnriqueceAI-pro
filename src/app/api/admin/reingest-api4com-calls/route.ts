import { NextResponse } from 'next/server';

import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { getAppUrl } from '@/lib/utils/app-url';

export const maxDuration = 300;

/**
 * One-shot admin endpoint to backfill API4COM calls from the past N hours.
 *
 * Use case: after fixing the classification/pagination bugs in the regular
 * reconcile worker, we need to retroactively pull calls that the old worker
 * silently dropped (≈19% gap measured against API4COM dashboard in mai/2026)
 * and reclassify connected/status on rows already in the table.
 *
 * This route doesn't duplicate logic — it just calls the reconcile worker
 * with a wide window. The reconcile worker is idempotent (upserts by
 * api4com_call_id and never downgrades connected=true), so this is safe to
 * re-run.
 *
 * Defaults to 720h (30d) per org. Override with body { windowHours, orgId }.
 * Hard cap: 1440h (60d) — same as the reconcile worker's MAX_WINDOW_HOURS.
 *
 * Auth: x-service-role header. Run with:
 *   curl -X POST https://app.enriqueceai.com.br/api/admin/reingest-api4com-calls \
 *     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"windowHours": 1080}'  # 45 days, covers Apr+May 2026
 */
export async function POST(request: Request) {
  if (!verifyServiceRole(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    windowHours?: number;
    orgId?: string;
  };

  const windowHours = body.windowHours ?? 720;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = getAppUrl();

  if (!serviceRoleKey) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 503 });
  }

  const reconcileUrl = `${appUrl}/api/workers/reconcile-api4com-calls`;
  const reconcileBody: Record<string, unknown> = { windowHours };
  if (body.orgId) reconcileBody.orgId = body.orgId;

  const start = Date.now();
  const res = await fetch(reconcileUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(reconcileBody),
  });

  const elapsedMs = Date.now() - start;
  const reconcileResult = await res.json().catch(() => ({ error: 'invalid_response' }));

  return NextResponse.json({
    triggered: 'reconcile-api4com-calls',
    windowHours,
    orgId: body.orgId ?? 'all',
    elapsedMs,
    status: res.status,
    result: reconcileResult,
  });
}
