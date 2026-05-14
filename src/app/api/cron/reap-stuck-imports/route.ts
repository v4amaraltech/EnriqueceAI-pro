import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export const maxDuration = 30;

// Imports older than this in 'processing' are considered stuck. Vercel
// kills server actions at 60s (free plan) or 300s (paid maxDuration); a
// 15-min cutoff is comfortably past either.
const STUCK_AFTER_MINUTES = 15;

/**
 * Mark stuck lead_imports as 'failed' so the UI stops showing the
 * eternal "processando..." spinner.
 *
 * Why this exists: when a CSV import server action exceeds Vercel's
 * function timeout the process dies before the final UPDATE that flips
 * status from 'processing' to 'completed'/'failed'. The row stays in
 * 'processing' forever. We've manually cleaned ~6 of these over the
 * past 2 days (Rafael Alécio's lista-FUNERÁRIA imports).
 *
 * The reaper computes the real result from the side-effects that did
 * land: count of leads inserted under that import_id + count of
 * lead_import_errors rows.
 */
async function handle(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const cutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000).toISOString();

  const { data: stuck } = (await from(supabase, 'lead_imports')
    .select('id, total_rows')
    .eq('status', 'processing')
    .lt('created_at', cutoff)
    .limit(50)) as { data: Array<{ id: string; total_rows: number }> | null };

  const imports = stuck ?? [];
  if (imports.length === 0) {
    return NextResponse.json({ checked_at: new Date().toISOString(), reaped: 0 });
  }

  const summary: Array<{ id: string; success: number; errors: number; final_status: string }> = [];

  for (const imp of imports) {
    const { count: leadsInserted } = (await from(supabase, 'leads')
      .select('id', { count: 'exact', head: true })
      .eq('import_id', imp.id)) as { count: number | null };

    const { count: errCount } = (await from(supabase, 'lead_import_errors')
      .select('id', { count: 'exact', head: true })
      .eq('import_id', imp.id)) as { count: number | null };

    const successCount = leadsInserted ?? 0;
    const errorCount = errCount ?? 0;
    // 'failed' when nothing landed, 'completed' when at least one lead did.
    // The UI distinguishes the two and the manager benefits from the split.
    const finalStatus = successCount > 0 ? 'completed' : 'failed';

    await from(supabase, 'lead_imports').update({
      status: finalStatus,
      success_count: successCount,
      error_count: errorCount,
      processed_rows: successCount + errorCount,
    } as Record<string, unknown>).eq('id', imp.id);

    summary.push({ id: imp.id, success: successCount, errors: errorCount, final_status: finalStatus });
  }

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    reaped: summary.length,
    summary,
  });
}

export const POST = handle;
export const GET = handle;
