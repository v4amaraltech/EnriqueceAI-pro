import type { Metadata } from 'next';
import { AlertTriangle } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchPlanComparison } from '@/features/billing/actions/fetch-billing';
import { PlanComparisonView } from '@/features/billing/components/PlanComparison';
import type { SubscriptionStatus } from '@/features/billing/types';

export const metadata: Metadata = {
  title: 'Escolha um plano | Flux',
};

export default async function UpgradePage() {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  // Check subscription status to customize the message
  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  let isCanceled = false;
  if (member) {
    const { data: subscription } = (await (
      supabase.from('subscriptions') as ReturnType<typeof supabase.from>
    )
      .select('status')
      .eq('org_id', member.org_id)
      .maybeSingle()) as { data: { status: SubscriptionStatus } | null };

    isCanceled = subscription?.status === 'canceled';
  }

  const result = await fetchPlanComparison();

  if (!result.success) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-[var(--muted-foreground)]">{result.error}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {isCanceled && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-800 dark:text-amber-200">
              Seu trial expirou
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Para continuar usando o Flux, escolha um plano abaixo.
            </p>
          </div>
        </div>
      )}

      <PlanComparisonView data={result.data} />
    </div>
  );
}
