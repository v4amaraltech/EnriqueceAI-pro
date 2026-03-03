'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { PlanRow, SubscriptionRow } from '../types';

export async function getOrgPlan(): Promise<ActionResult<PlanRow>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data: subscription } = (await (supabase
    .from('subscriptions') as ReturnType<typeof supabase.from>)
    .select('plan_id')
    .eq('org_id', member.org_id)
    .maybeSingle()) as { data: Pick<SubscriptionRow, 'plan_id'> | null };

  if (!subscription) {
    return { success: false, error: 'Assinatura não encontrada' };
  }

  const { data: plan } = (await (supabase
    .from('plans') as ReturnType<typeof supabase.from>)
    .select('*')
    .eq('id', subscription.plan_id)
    .single()) as { data: PlanRow | null };

  if (!plan) {
    return { success: false, error: 'Plano não encontrado' };
  }

  return { success: true, data: plan };
}
