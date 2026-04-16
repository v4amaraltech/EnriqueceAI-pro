import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createNotification } from '@/features/notifications/services/notification.service';

export const maxDuration = 60;

const NOTIFICATION_COOLDOWN_HOURS = 24;

/**
 * Daily check of Google Calendar/Gmail connections.
 * Notifies SDRs whose connection is in `error` state so they can reconnect
 * before it impacts productivity (failed meeting scheduling, missed email sends, etc).
 *
 * Respects a 24h cooldown per connection to avoid notification spam.
 */
export async function POST(request: Request) {
  if (!verifyServiceRole(request) && !verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const cooldownCutoff = new Date(Date.now() - NOTIFICATION_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

  // Find Google connections in error state
  const [calendarResult, gmailResult] = await Promise.all([
    from(supabase, 'calendar_connections')
      .select('id, org_id, user_id, calendar_email, status, updated_at')
      .eq('status', 'error') as Promise<{
      data: Array<{ id: string; org_id: string; user_id: string; calendar_email: string; status: string; updated_at: string }> | null;
    }>,
    from(supabase, 'gmail_connections')
      .select('id, org_id, user_id, email_address, status, updated_at')
      .eq('status', 'error') as Promise<{
      data: Array<{ id: string; org_id: string; user_id: string; email_address: string; status: string; updated_at: string }> | null;
    }>,
  ]);

  // Merge unique (user_id, org_id) pairs from either table
  const affectedMap = new Map<string, { user_id: string; org_id: string; email: string; source: string }>();
  for (const c of calendarResult.data ?? []) {
    const key = `${c.org_id}:${c.user_id}`;
    affectedMap.set(key, { user_id: c.user_id, org_id: c.org_id, email: c.calendar_email, source: 'Google Calendar' });
  }
  for (const g of gmailResult.data ?? []) {
    const key = `${g.org_id}:${g.user_id}`;
    if (!affectedMap.has(key)) {
      affectedMap.set(key, { user_id: g.user_id, org_id: g.org_id, email: g.email_address, source: 'Gmail' });
    }
  }

  if (affectedMap.size === 0) {
    return NextResponse.json({ checked: 0, notified: 0, message: 'No connections in error state' });
  }

  let notified = 0;
  let skipped = 0;

  for (const { user_id, org_id, source } of affectedMap.values()) {
    // Check cooldown: has this user already been notified about an integration_error in the last 24h?
    const { data: recentNotif } = (await from(supabase, 'notifications')
      .select('id')
      .eq('user_id', user_id)
      .eq('org_id', org_id)
      .eq('type', 'integration_error')
      .eq('resource_type', 'integration')
      .eq('resource_id', 'google')
      .gte('created_at', cooldownCutoff)
      .limit(1)
      .maybeSingle()) as { data: { id: string } | null };

    if (recentNotif) {
      skipped++;
      continue;
    }

    try {
      await createNotification({
        org_id,
        user_id,
        type: 'integration_error',
        title: 'Google desconectado',
        body: `Sua conexão com ${source} expirou. Reconecte em Configurações > Integrações para continuar enviando e-mails e agendando reuniões.`,
        resource_type: 'integration',
        resource_id: 'google',
        metadata: { source, reason: 'connection_in_error_state' },
      });
      notified++;
    } catch (err) {
      console.error(`[check-google-connections] Failed to notify ${user_id}:`, err);
    }
  }

  return NextResponse.json({
    checked: affectedMap.size,
    notified,
    skipped,
    message: `${notified} users notified, ${skipped} skipped (cooldown)`,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
