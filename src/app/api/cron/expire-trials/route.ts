import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export const maxDuration = 60;

async function expireTrials() {
  const supabase = createServiceRoleClient();

  // Send trial_expiring notifications for trials expiring within 3 days
  const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: expiringTrials } = (await from(supabase, 'subscriptions')
    .select('org_id, current_period_end')
    .eq('status', 'trialing')
    .lte('current_period_end', threeDaysFromNow)
    .gt('current_period_end', new Date().toISOString())) as {
    data: Array<{ org_id: string; current_period_end: string }> | null;
  };

  let notified = 0;
  const trials = expiringTrials ?? [];

  if (trials.length > 0) {
    const orgIds = trials.map((t) => t.org_id);

    // Batch: fetch all managers + existing notifications in parallel (fixes N+1)
    const today = new Date().toISOString().slice(0, 10);
    const [managersResult, notifsResult] = await Promise.all([
      from(supabase, 'organization_members')
        .select('user_id, org_id')
        .in('org_id', orgIds)
        .eq('role', 'manager')
        .eq('status', 'active') as Promise<{ data: Array<{ user_id: string; org_id: string }> | null }>,
      from(supabase, 'notifications')
        .select('user_id')
        .eq('type', 'trial_expiring')
        .gte('created_at', today) as Promise<{ data: Array<{ user_id: string }> | null }>,
    ]);

    const alreadyNotified = new Set((notifsResult.data ?? []).map((n) => n.user_id));

    // Group managers by org
    const managersByOrg = new Map<string, string[]>();
    for (const m of managersResult.data ?? []) {
      const list = managersByOrg.get(m.org_id) ?? [];
      list.push(m.user_id);
      managersByOrg.set(m.org_id, list);
    }

    for (const trial of trials) {
      const daysLeft = Math.max(0, Math.ceil(
        (new Date(trial.current_period_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      ));

      for (const userId of managersByOrg.get(trial.org_id) ?? []) {
        if (alreadyNotified.has(userId)) continue;

        await from(supabase, 'notifications')
          .insert({
            user_id: userId,
            org_id: trial.org_id,
            type: 'trial_expiring',
            title: 'Trial expirando',
            message: `Seu trial expira em ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}. Faça upgrade para não perder acesso.`,
          } as Record<string, unknown>);
        alreadyNotified.add(userId);
        notified++;
      }
    }
  }

  // Expire trials past their period end
  const { data: expired, error } = (await from(supabase, 'subscriptions')
    .update({ status: 'canceled', updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('status', 'trialing')
    .lt('current_period_end', new Date().toISOString())
    .select('id')) as { data: Array<{ id: string }> | null; error: { message: string } | null };

  if (error) {
    return { success: false as const, error: error.message };
  }

  return { success: true as const, data: { expired: expired?.length ?? 0, notified } };
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await expireTrials();

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: result.data });
}
