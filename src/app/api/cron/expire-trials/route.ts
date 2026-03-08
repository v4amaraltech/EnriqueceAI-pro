import crypto from 'crypto';

import { NextResponse } from 'next/server';

import { createServiceRoleClient } from '@/lib/supabase/service';

function verifyAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization') ?? '';
  const expectedToken = process.env.CRON_SECRET;
  if (!expectedToken) return false;
  const expected = `Bearer ${expectedToken}`;
  try {
    return (
      Buffer.byteLength(authHeader) === Buffer.byteLength(expected) &&
      crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
    );
  } catch {
    return false;
  }
}

async function expireTrials() {
  const supabase = createServiceRoleClient();

  // Send trial_expiring notifications for trials expiring within 3 days
  const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: expiringTrials } = (await (supabase
    .from('subscriptions') as ReturnType<typeof supabase.from>)
    .select('org_id, current_period_end')
    .eq('status', 'trialing')
    .lte('current_period_end', threeDaysFromNow)
    .gt('current_period_end', new Date().toISOString())) as {
    data: Array<{ org_id: string; current_period_end: string }> | null;
  };

  let notified = 0;
  for (const trial of expiringTrials ?? []) {
    const daysLeft = Math.max(0, Math.ceil(
      (new Date(trial.current_period_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    ));

    // Get manager user_ids for this org
    const { data: managers } = await supabase
      .from('organization_members')
      .select('user_id')
      .eq('org_id', trial.org_id)
      .eq('role', 'manager')
      .eq('status', 'active');

    for (const manager of managers ?? []) {
      // Check if already notified today to avoid duplicates
      const today = new Date().toISOString().slice(0, 10);
      const { data: existing } = (await (supabase
        .from('notifications') as ReturnType<typeof supabase.from>)
        .select('id')
        .eq('user_id', manager.user_id)
        .eq('type', 'trial_expiring')
        .gte('created_at', today)
        .limit(1)
        .maybeSingle()) as { data: { id: string } | null };

      if (!existing) {
        await (supabase.from('notifications') as ReturnType<typeof supabase.from>)
          .insert({
            user_id: manager.user_id,
            org_id: trial.org_id,
            type: 'trial_expiring',
            title: 'Trial expirando',
            message: `Seu trial expira em ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}. Faça upgrade para não perder acesso.`,
          } as Record<string, unknown>);
        notified++;
      }
    }
  }

  // Expire trials past their period end
  const { data: expired, error } = (await (supabase
    .from('subscriptions') as ReturnType<typeof supabase.from>)
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
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await expireTrials();

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: result.data });
}
