'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { calculateUsageLimits } from '../services/feature-flags';
import type {
  AiDailyUsage,
  AiUsageRow,
  PlanRow,
  SubscriptionRow,
  UsageDashboardData,
  WhatsAppCreditsRow,
} from '../types';

export async function fetchUsageDashboard(): Promise<ActionResult<UsageDashboardData>> {
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

  // Fetch subscription
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

  const today = new Date().toISOString().split('T')[0]!;
  const currentPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM

  // Fetch counts in parallel
  const [leadsResult, aiUsageResult, waCreditsResult, memberCountResult, aiHistoryResult] =
    await Promise.all([
      // Lead count
      from(supabase, 'leads')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', member.org_id)
        .is('deleted_at', null) as Promise<{ count: number | null }>,

      // AI usage today
      from(supabase, 'ai_usage')
        .select('generation_count, daily_limit')
        .eq('org_id', member.org_id)
        .eq('usage_date', today)
        .maybeSingle() as Promise<{ data: AiUsageRow | null }>,

      // WhatsApp credits
      from(supabase, 'whatsapp_credits')
        .select('used_credits, plan_credits, period')
        .eq('org_id', member.org_id)
        .eq('period', currentPeriod)
        .maybeSingle() as Promise<{ data: WhatsAppCreditsRow | null }>,

      // Member count
      from(supabase, 'organization_members')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', member.org_id)
        .eq('status', 'active') as Promise<{ count: number | null }>,

      // AI history (last 30 days)
      from(supabase, 'ai_usage')
        .select('usage_date, generation_count')
        .eq('org_id', member.org_id)
        .gte('usage_date', getDateDaysAgo(30))
        .order('usage_date', { ascending: true }) as Promise<{
          data: Array<{ usage_date: string; generation_count: number }> | null;
        }>,
    ]);

  const currentLeads = leadsResult.count ?? 0;
  const aiUsedToday = aiUsageResult.data?.generation_count ?? 0;
  const waUsedThisMonth = waCreditsResult.data?.used_credits ?? 0;
  const memberCount = memberCountResult.count ?? 1;

  // Build 30-day history with zero-fill
  const aiHistory = fillAiHistory(aiHistoryResult.data ?? []);

  const limits = calculateUsageLimits(
    plan,
    currentLeads,
    aiUsedToday,
    waUsedThisMonth,
    memberCount,
  );

  return {
    success: true,
    data: { limits, plan, aiHistory },
  };
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0]!;
}

function fillAiHistory(
  rows: Array<{ usage_date: string; generation_count: number }>,
): AiDailyUsage[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.usage_date, row.generation_count);
  }

  const result: AiDailyUsage[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0]!;
    result.push({ date: key, count: map.get(key) ?? 0 });
  }

  return result;
}
