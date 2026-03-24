'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { PlanRow, SubscriptionRow } from '../types';

export async function getOrgPlan(): Promise<ActionResult<PlanRow>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data: subscription } = (await from(supabase, 'subscriptions')
    .select('plan_id')
    .eq('org_id', orgId)
    .maybeSingle()) as { data: Pick<SubscriptionRow, 'plan_id'> | null };

  if (!subscription) {
    return { success: false, error: 'Assinatura não encontrada' };
  }

  const { data: plan } = (await from(supabase, 'plans')
    .select('*')
    .eq('id', subscription.plan_id)
    .single()) as { data: PlanRow | null };

  if (!plan) {
    return { success: false, error: 'Plano não encontrado' };
  }

  return { success: true, data: plan };
}
