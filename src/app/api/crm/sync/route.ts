import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/require-auth';
import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { CrmConnectionRow } from '@/features/integrations/types/crm';
import { CrmSyncService } from '@/features/integrations/services/crm-sync.service';

interface SyncRequestBody {
  connectionId?: string;
}

/**
 * POST /api/crm/sync
 * Triggers CRM sync. Can sync a specific connection or all active connections.
 * Called by:
 * - Manual sync button (with connectionId) — requires user auth
 * - pg_cron every 30 minutes (without connectionId = sync all) — requires CRON_SECRET
 */
export async function POST(request: Request) {
  try {
    const isCron = verifyCronSecret(request);
    const body = (await request.json()) as SyncRequestBody;

    if (body.connectionId) {
      // Manual sync: require authenticated user + verify connection belongs to their org
      await requireAuth();
      const supabaseUser = await createServerSupabaseClient();
      const { data: conn } = await from(supabaseUser, 'crm_connections')
        .select('id')
        .eq('id', body.connectionId)
        .maybeSingle();
      if (!conn) {
        return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
      }
      const result = await CrmSyncService.syncConnection(body.connectionId);
      return NextResponse.json({
        success: true,
        data: result,
      });
    }

    // Batch sync: require CRON_SECRET
    if (!isCron) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Sync all active connections using service role (no cookies in cron)
    const supabase = createServiceRoleClient();
    const { data: connections } = (await from(supabase, 'crm_connections')
      .select('id')
      .eq('status', 'connected')) as { data: Pick<CrmConnectionRow, 'id'>[] | null };

    const results = [];
    for (const conn of connections ?? []) {
      try {
        const result = await CrmSyncService.syncConnection(conn.id);
        results.push({ connectionId: conn.id, ...result });
      } catch (error) {
        results.push({
          connectionId: conn.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Sync failed',
      },
      { status: 500 },
    );
  }
}
