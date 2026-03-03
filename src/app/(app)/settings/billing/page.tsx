import { CreditCard } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';

import { EmptyState } from '@/shared/components/EmptyState';

import { fetchBillingOverview, fetchPlanComparison } from '@/features/billing/actions/fetch-billing';
import { fetchUsageDashboard } from '@/features/billing/actions/fetch-usage-dashboard';
import { BillingView } from '@/features/billing/components/BillingView';
import { PlanComparisonView } from '@/features/billing/components/PlanComparison';
import { UsageDashboard } from '@/features/billing/components/UsageDashboard';

export default async function BillingPage() {
  await requireAuth();

  const [overviewResult, comparisonResult, usageResult] = await Promise.all([
    fetchBillingOverview(),
    fetchPlanComparison(),
    fetchUsageDashboard(),
  ]);

  if (!overviewResult.success) {
    return (
      <EmptyState
        icon={CreditCard}
        title="Billing"
        description={overviewResult.error}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">Planos e Assinatura</h1>
      <div className="space-y-8">
        <BillingView data={overviewResult.data} />
        {usageResult.success && (
          <UsageDashboard data={usageResult.data} />
        )}
        {comparisonResult.success && (
          <PlanComparisonView data={comparisonResult.data} />
        )}
      </div>
    </div>
  );
}
