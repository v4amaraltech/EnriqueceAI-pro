import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export const maxDuration = 60;

/**
 * Ghost call cleanup — runs daily.
 *
 * "Ghost calls" are rows created by the in-app dialer (POST /dialer in API4COM)
 * that never received a corresponding channel-hangup webhook. They sit in the
 * `calls` table forever with:
 *   - metadata.gateway = 'flux-*' (dialer-initiated)
 *   - metadata.source IS NULL (reconciler/webhook never claimed it)
 *   - hangup_cause IS NULL
 *   - duration_seconds = 0
 *
 * They inflate Enriquece dashboards but DON'T appear in API4COM's dashboard
 * "Chamadas por Ramal" — leading to the gap surfaced in the V4 Amaral briefing
 * 2026-05-17. Phase 1 historical dedupe + this ongoing cleanup keep
 * enriquece.calls aligned with the API4COM dashboard.
 *
 * Safety: only deletes rows OLDER than 6h. Gives the webhook + reconciler plenty
 * of time to associate the row. If the row's still ghost after 6h, the
 * webhook will not arrive (API4COM never confirmed the call dialed).
 */
const GHOST_AGE_HOURS = 6;

export async function POST(request: Request) {
  if (!verifyServiceRole(request) && !verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const cutoff = new Date(Date.now() - GHOST_AGE_HOURS * 3_600_000).toISOString();

  const { data: ghosts, error: selectErr } = (await from(supabase, 'calls')
    .select('id, org_id, origin, started_at')
    .like('metadata->>gateway', 'flux-%')
    .is('metadata->>source', null)
    .is('hangup_cause', null)
    .eq('duration_seconds', 0)
    .lte('created_at', cutoff)
    .limit(5000)) as { data: Array<{ id: string; org_id: string; origin: string; started_at: string }> | null; error: { message: string } | null };

  if (selectErr) {
    return NextResponse.json({ error: `select_failed: ${selectErr.message}` }, { status: 500 });
  }

  const found = ghosts ?? [];
  if (found.length === 0) {
    return NextResponse.json({ cutoff, deleted: 0, message: 'No ghost calls older than cutoff' });
  }

  const ids = found.map((g) => g.id);
  const { error: deleteErr } = await from(supabase, 'calls').delete().in('id', ids);

  if (deleteErr) {
    return NextResponse.json({ error: `delete_failed: ${deleteErr.message}` }, { status: 500 });
  }

  const perOrg = found.reduce<Record<string, number>>((acc, g) => {
    acc[g.org_id] = (acc[g.org_id] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    cutoff,
    deleted: found.length,
    per_org: perOrg,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
