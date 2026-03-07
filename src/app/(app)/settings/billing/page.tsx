import { Suspense } from 'react';
import { CreditCard } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';

import { EmptyState } from '@/shared/components/EmptyState';

import { fetchBillingOverview, fetchPlanComparison } from '@/features/billing/actions/fetch-billing';
import { fetchInvoices } from '@/features/billing/actions/fetch-invoices';
import { fetchPaymentMethod } from '@/features/billing/actions/fetch-payment-method';
import { fetchUsageDashboard } from '@/features/billing/actions/fetch-usage-dashboard';
import { BillingView } from '@/features/billing/components/BillingView';
import { InvoiceHistory } from '@/features/billing/components/InvoiceHistory';
import { PaymentMethod } from '@/features/billing/components/PaymentMethod';
import { PlanComparisonView } from '@/features/billing/components/PlanComparison';
import { StripeReturnToast } from '@/features/billing/components/StripeReturnToast';
import { UsageDashboard } from '@/features/billing/components/UsageDashboard';

export default async function BillingPage() {
  await requireAuth();

  const [overviewResult, comparisonResult, usageResult, invoicesResult, paymentResult] = await Promise.all([
    fetchBillingOverview(),
    fetchPlanComparison(),
    fetchUsageDashboard(),
    fetchInvoices(),
    fetchPaymentMethod(),
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

  const hasStripeSubscription = !!overviewResult.data.subscription.stripe_subscription_id;

  return (
    <div className="mx-auto max-w-4xl p-8">
      <Suspense>
        <StripeReturnToast />
      </Suspense>
      <h1 className="mb-6 text-2xl font-bold">Planos e Assinatura</h1>
      <div className="space-y-8">
        <BillingView data={overviewResult.data} />
        {usageResult.success && (
          <UsageDashboard data={usageResult.data} />
        )}
        <PaymentMethod
          method={paymentResult.success ? paymentResult.data : null}
          hasStripeSubscription={hasStripeSubscription}
        />
        <InvoiceHistory
          invoices={invoicesResult.success ? invoicesResult.data : []}
        />
        {comparisonResult.success && (
          <PlanComparisonView data={comparisonResult.data} />
        )}
      </div>
    </div>
  );
}
