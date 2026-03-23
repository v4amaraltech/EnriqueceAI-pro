import type { Metadata } from 'next';

import { AlertTriangle } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchPlanComparison } from '@/features/billing/actions/fetch-billing';
import type { SubscriptionStatus } from '@/features/billing/types';
import { PlanComparisonView } from '@/features/billing/components/PlanComparison';

export const metadata: Metadata = {
  title: 'Escolha um plano | Enriquece AI',
};

export default async function UpgradePage() {
  const [result, trialExpired] = await Promise.all([
    fetchPlanComparison(),
    isTrialExpired(),
  ]);

  if (!result.success) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{result.error}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {trialExpired && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-300/50 bg-yellow-50 p-4 dark:border-yellow-700/50 dark:bg-yellow-900/20">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 text-yellow-600 dark:text-yellow-400" />
          <div>
            <p className="font-medium text-yellow-800 dark:text-yellow-200">
              Seu período de avaliação terminou
            </p>
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              Escolha um plano abaixo para continuar usando o Enriquece AI.
            </p>
          </div>
        </div>
      )}
      <PlanComparisonView data={result.data} />
    </div>
  );
}

async function isTrialExpired(): Promise<boolean> {
  try {
    const user = await requireAuth();
    const supabase = await createServerSupabaseClient();

    const { data: member } = (await supabase
      .from('organization_members')
      .select('org_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()) as { data: { org_id: string } | null };

    if (!member) return false;

    const { data: sub } = (await from(supabase, 'subscriptions')
      .select('status, current_period_end')
      .eq('org_id', member.org_id)
      .maybeSingle()) as { data: { status: SubscriptionStatus; current_period_end: string } | null };

    if (!sub) return false;

    return (
      sub.status === 'canceled' ||
      (sub.status === 'trialing' && new Date(sub.current_period_end) < new Date())
    );
  } catch {
    return false;
  }
}
