import type { Metadata } from 'next';

import { fetchPlanComparison } from '@/features/billing/actions/fetch-billing';
import { PlanComparisonView } from '@/features/billing/components/PlanComparison';

export const metadata: Metadata = {
  title: 'Escolha um plano | Flux',
};

export default async function UpgradePage() {
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
      <PlanComparisonView data={result.data} />
    </div>
  );
}
