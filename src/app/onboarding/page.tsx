import { redirect } from 'next/navigation';

import { requireAuth } from '@/lib/auth/require-auth';

import { checkNeedsOnboarding } from '@/features/auth/actions/complete-onboarding';
import { fetchPlanComparison } from '@/features/billing/actions/fetch-billing';

import { OnboardingWizard } from './OnboardingWizard';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAuth();

  const onboardingStep = await checkNeedsOnboarding();
  if (onboardingStep === false) {
    redirect('/dashboard');
  }

  // Fetch plans for plan selection step
  const plansResult = await fetchPlanComparison();
  const plans = plansResult.success ? plansResult.data.plans : [];

  // Check for Stripe/Gmail return params
  const params = await searchParams;
  const rawStep = typeof params.step === 'string' ? parseInt(params.step, 10) : undefined;
  // Clamp returnStep to at most onboardingStep + 1 to prevent skipping
  const returnStep = rawStep !== undefined && !isNaN(rawStep)
    ? Math.min(rawStep, onboardingStep + 1)
    : undefined;
  const checkoutSuccess = params.success === 'true';
  const gmailConnected = params.gmail === 'connected';

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
      <OnboardingWizard
        initialStep={returnStep ?? onboardingStep}
        plans={plans}
        checkoutSuccess={checkoutSuccess}
        gmailConnected={gmailConnected}
      />
    </div>
  );
}
