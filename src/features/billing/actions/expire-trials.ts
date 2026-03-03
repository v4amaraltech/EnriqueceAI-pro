import { createServiceRoleClient } from '@/lib/supabase/service';
import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

interface ExpireTrialsResult {
  expired: number;
  notified: number;
}

export async function expireTrialsCron(): Promise<ExpireTrialsResult> {
  const supabase = createServiceRoleClient();

  // 1. Expire trials where current_period_end has passed
  const { data: expiredSubs, error: expireError } = (await (
    supabase.from('subscriptions') as ReturnType<typeof supabase.from>
  )
    .update({ status: 'canceled' } as unknown as Record<string, unknown>)
    .eq('status', 'trialing')
    .lt('current_period_end', new Date().toISOString())
    .select('org_id')) as { data: Array<{ org_id: string }> | null; error: { message: string } | null };

  if (expireError) {
    console.error('Failed to expire trials:', expireError.message);
    throw new Error(`Failed to expire trials: ${expireError.message}`);
  }

  const expiredCount = expiredSubs?.length ?? 0;
  if (expiredCount > 0) {
    console.warn(`Expired ${expiredCount} trial subscriptions`);
  }

  // 2. Find trials expiring in ~7 days (between 6 and 8 days from now)
  const now = new Date();
  const sixDays = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString();
  const eightDays = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString();

  const { data: expiringTrials, error: queryError } = (await (
    supabase.from('subscriptions') as ReturnType<typeof supabase.from>
  )
    .select('org_id')
    .eq('status', 'trialing')
    .gte('current_period_end', sixDays)
    .lt('current_period_end', eightDays)) as {
    data: Array<{ org_id: string }> | null;
    error: { message: string } | null;
  };

  if (queryError) {
    console.error('Failed to query expiring trials:', queryError.message);
    throw new Error(`Failed to query expiring trials: ${queryError.message}`);
  }

  let notifiedCount = 0;

  for (const trial of expiringTrials ?? []) {
    // Deduplicate: check if we already sent a trial_expiring notification today for this org
    const today = new Date().toISOString().split('T')[0];
    const { data: existing } = (await (
      supabase.from('notifications') as ReturnType<typeof supabase.from>
    )
      .select('id')
      .eq('org_id', trial.org_id)
      .eq('type', 'trial_expiring')
      .gte('created_at', `${today}T00:00:00Z`)
      .lt('created_at', `${today}T23:59:59Z`)
      .limit(1)) as { data: Array<{ id: string }> | null };

    if (existing && existing.length > 0) {
      continue;
    }

    await createNotificationsForOrgMembers({
      orgId: trial.org_id,
      type: 'trial_expiring',
      title: 'Seu trial expira em 7 dias',
      body: 'Faça upgrade para continuar usando o Flux sem interrupções.',
      roleFilter: 'manager',
      metadata: { channel: 'trial' },
    });

    notifiedCount++;
  }

  if (notifiedCount > 0) {
    console.warn(`Sent trial expiring notifications to ${notifiedCount} orgs`);
  }

  return { expired: expiredCount, notified: notifiedCount };
}
