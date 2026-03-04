import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { CrmConnectionRow } from '@/features/integrations/types/crm';
import { CrmSyncService } from '@/features/integrations/services/crm-sync.service';

interface SyncRequestBody {
  connectionId?: string;
}

function verifyCronAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  const expectedToken = process.env.CRON_SECRET;
  return !!expectedToken && authHeader === `Bearer ${expectedToken}`;
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
    const isCron = verifyCronAuth(request);
    const body = (await request.json()) as SyncRequestBody;

    if (body.connectionId) {
      // Manual sync: require authenticated user
      await requireAuth();
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
    const { data: connections } = (await (supabase
      .from('crm_connections') as ReturnType<typeof supabase.from>)
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
