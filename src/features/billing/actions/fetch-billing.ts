'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { calculateMonthlyTotal } from '../services/feature-flags';
import type {
  AiUsageRow,
  BillingOverview,
  PlanComparison,
  PlanRow,
  SubscriptionRow,
  WhatsAppCreditsRow,
} from '../types';

export async function fetchBillingOverview(): Promise<ActionResult<BillingOverview>> {
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

  // Fetch subscription with plan
  const { data: subscription } = (await from(supabase, 'subscriptions')
    .select('*')
    .eq('org_id', member.org_id)
    .maybeSingle()) as { data: SubscriptionRow | null };

  if (!subscription) {
    return { success: false, error: 'Assinatura não encontrada' };
  }

  // Fetch plan
  const { data: plan } = (await from(supabase, 'plans')
    .select('*')
    .eq('id', subscription.plan_id)
    .single()) as { data: PlanRow | null };

  if (!plan) {
    return { success: false, error: 'Plano não encontrado' };
  }

  // Fetch member count
  const { count: memberCount } = (await from(supabase, 'organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', member.org_id)
    .eq('status', 'active')) as { count: number | null };

  const totalMembers = memberCount ?? 1;
  const additionalUsers = Math.max(0, totalMembers - plan.included_users);

  // Fetch AI usage today
  const today = new Date().toISOString().split('T')[0];
  const { data: aiUsage } = (await from(supabase, 'ai_usage')
    .select('generation_count, daily_limit')
    .eq('org_id', member.org_id)
    .eq('usage_date', today)
    .maybeSingle()) as { data: AiUsageRow | null };

  // Fetch WhatsApp credits for current month
  const currentPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM
  const { data: waCredits } = (await from(supabase, 'whatsapp_credits')
    .select('used_credits, plan_credits, period')
    .eq('org_id', member.org_id)
    .eq('period', currentPeriod)
    .maybeSingle()) as { data: WhatsAppCreditsRow | null };

  return {
    success: true,
    data: {
      plan,
      subscription,
      memberCount: totalMembers,
      additionalUsers,
      monthlyTotal: calculateMonthlyTotal(plan, totalMembers),
      aiUsageToday: {
        used: aiUsage?.generation_count ?? 0,
        limit: plan.max_ai_per_day,
      },
      whatsappUsage: {
        used: waCredits?.used_credits ?? 0,
        limit: plan.max_whatsapp_per_month,
        period: currentPeriod,
      },
    },
  };
}

export async function fetchPlanComparison(): Promise<ActionResult<PlanComparison>> {
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

  // Fetch all active plans
  const { data: plans } = (await from(supabase, 'plans')
    .select('*')
    .eq('active', true)
    .order('price_cents', { ascending: true })) as { data: PlanRow[] | null };

  // Get current subscription
  const { data: subscription } = (await from(supabase, 'subscriptions')
    .select('plan_id')
    .eq('org_id', member.org_id)
    .maybeSingle()) as { data: { plan_id: string } | null };

  // Find current plan slug
  const currentPlan = (plans ?? []).find((p) => p.id === subscription?.plan_id);

  return {
    success: true,
    data: {
      plans: plans ?? [],
      currentPlanSlug: currentPlan?.slug ?? '',
    },
  };
}
