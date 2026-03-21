'use client';

import { useTransition } from 'react';
import { CreditCard, Loader2, PartyPopper } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';

import { createCheckoutSession } from '@/features/billing/actions/create-checkout';
import type { PlanRow } from '@/features/billing/types';
import { formatCents } from '@/features/billing/services/feature-flags';

interface OnboardingCheckoutStepProps {
  selectedPlan: PlanRow | null;
  checkoutSuccess: boolean;
  onSkip: () => void;
  onBack: () => void;
  onNext: () => void;
}

export function OnboardingCheckoutStep({
  selectedPlan,
  checkoutSuccess,
  onSkip,
  onBack,
  onNext,
}: OnboardingCheckoutStepProps) {
  const [isPending, startTransition] = useTransition();

  // If checkout just completed, show success and auto-advance
  if (checkoutSuccess) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <PartyPopper className="mx-auto h-10 w-10 text-green-500" />
          <h1 className="mt-4 text-2xl font-bold">Pagamento confirmado!</h1>
          <p className="mt-2 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Seu plano foi ativado. Vamos continuar a configuração.
          </p>
        </div>
        <Button onClick={onNext} className="w-full">
          Continuar
        </Button>
      </div>
    );
  }

  const isStarter = selectedPlan?.slug === 'starter';

  function handleCheckout() {
    if (!selectedPlan) return;
    startTransition(async () => {
      const result = await createCheckoutSession(
        selectedPlan.id,
        '/onboarding?step=2&success=true',
      );
      if (!result.success) {
        toast.error(result.error);
      }
      // On success, Stripe redirects — we don't reach here
    });
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <CreditCard className="mx-auto h-10 w-10 text-[var(--primary)]" />
        <h1 className="mt-4 text-2xl font-bold">
          {isStarter ? 'Trial gratuito' : 'Pagamento'}
        </h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          {isStarter
            ? 'Você selecionou o plano Starter com 14 dias de trial gratuito.'
            : `Plano ${selectedPlan?.name ?? ''} — ${selectedPlan ? formatCents(selectedPlan.price_cents) : ''}/mês`}
        </p>
      </div>

      {isStarter ? (
        <div className="space-y-3">
          <Button onClick={onSkip} className="w-full">
            Continuar com trial gratuito
          </Button>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack} className="flex-1">
              Voltar
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Button onClick={handleCheckout} disabled={isPending} className="w-full">
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Ir para pagamento
          </Button>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack} className="flex-1">
              Voltar
            </Button>
            <Button variant="ghost" onClick={onSkip} className="flex-1">
              Continuar com trial
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
