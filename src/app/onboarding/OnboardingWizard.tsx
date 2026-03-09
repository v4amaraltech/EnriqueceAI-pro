'use client';

import { useState, useTransition } from 'react';

import Image from 'next/image';
import { useRouter } from 'next/navigation';

import { Building2, CreditCard, Loader2, Mail, Rocket, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import { completeOnboarding } from '@/features/auth/actions/complete-onboarding';
import { saveOnboardingStep } from '@/features/auth/actions/save-onboarding-step';
import type { PlanRow } from '@/features/billing/types';

import { OnboardingCheckoutStep } from './steps/OnboardingCheckoutStep';
import { OnboardingCompleteStep } from './steps/OnboardingCompleteStep';
import { OnboardingGmailStep } from './steps/OnboardingGmailStep';
import { OnboardingInviteStep } from './steps/OnboardingInviteStep';
import { OnboardingPlanStep } from './steps/OnboardingPlanStep';

const STEPS = [
  { title: 'Empresa', icon: Building2 },
  { title: 'Plano', icon: Sparkles },
  { title: 'Pagamento', icon: CreditCard },
  { title: 'Gmail', icon: Mail },
  { title: 'Equipe', icon: Users },
  { title: 'Pronto!', icon: Rocket },
];

interface OnboardingWizardProps {
  initialStep: number;
  plans: PlanRow[];
  checkoutSuccess: boolean;
  gmailConnected: boolean;
}

export function OnboardingWizard({
  initialStep,
  plans,
  checkoutSuccess,
  gmailConnected: initialGmailConnected,
}: OnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [orgName, setOrgName] = useState('');
  const [isPending, startTransition] = useTransition();
  const [selectedPlan, setSelectedPlan] = useState<PlanRow | null>(null);
  const [gmailConnected, _setGmailConnected] = useState(initialGmailConnected);
  const [teamInvited, setTeamInvited] = useState(false);

  function goToStep(nextStep: number) {
    setStep(nextStep);
    // Persist step progress (fire-and-forget)
    saveOnboardingStep(nextStep);
  }

  function handleSaveOrg() {
    if (!orgName.trim()) {
      toast.error('Informe o nome da empresa');
      return;
    }

    startTransition(async () => {
      const result = await completeOnboarding({ orgName });
      if (result.success) {
        setStep(1); // completeOnboarding already sets onboarding_step = 1
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleFinish() {
    startTransition(async () => {
      await saveOnboardingStep(null); // Mark onboarding as complete
      router.push('/dashboard');
    });
  }

  return (
    <div className="w-full max-w-lg">
      {/* Progress */}
      <div className="mb-8 flex items-center justify-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s.title} className="flex items-center gap-1">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                i <= step
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
              }`}
            >
              {i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-0.5 w-6 transition-colors ${
                  i < step ? 'bg-[var(--primary)]' : 'bg-[var(--muted)]'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Card */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        {/* Step 0: Company Name */}
        {step === 0 && (
          <div className="space-y-6">
            <div className="text-center">
              <Image
                src="/logos/logo-ea-red.png"
                alt="Enriquece AI"
                width={48}
                height={48}
                className="mx-auto rounded-full"
                unoptimized
              />
              <h1 className="mt-4 text-2xl font-bold">Bem-vindo ao Enriquece AI!</h1>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                Primeiro, como se chama sua empresa?
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="orgName">Nome da Empresa</Label>
              <Input
                id="orgName"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Ex: Minha Empresa Ltda"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleSaveOrg()}
              />
            </div>

            <Button onClick={handleSaveOrg} disabled={isPending} className="w-full">
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Continuar
            </Button>
          </div>
        )}

        {/* Step 1: Plan Selection */}
        {step === 1 && (
          <OnboardingPlanStep
            plans={plans}
            onSelect={(plan) => {
              setSelectedPlan(plan);
              goToStep(2);
            }}
            onBack={() => goToStep(0)}
          />
        )}

        {/* Step 2: Checkout */}
        {step === 2 && (
          <OnboardingCheckoutStep
            selectedPlan={selectedPlan}
            checkoutSuccess={checkoutSuccess}
            onSkip={() => goToStep(3)}
            onBack={() => goToStep(1)}
            onNext={() => goToStep(3)}
          />
        )}

        {/* Step 3: Gmail */}
        {step === 3 && (
          <OnboardingGmailStep
            gmailConnected={gmailConnected}
            onNext={() => goToStep(4)}
            onBack={() => goToStep(2)}
          />
        )}

        {/* Step 4: Invite Team */}
        {step === 4 && (
          <OnboardingInviteStep
            onNext={() => {
              setTeamInvited(true);
              goToStep(5);
            }}
            onBack={() => goToStep(3)}
          />
        )}

        {/* Step 5: Complete */}
        {step === 5 && (
          <OnboardingCompleteStep
            completedItems={{
              company: true, // Always true if they got here
              plan: selectedPlan !== null || checkoutSuccess,
              payment: checkoutSuccess || (selectedPlan?.slug === 'starter'),
              gmail: gmailConnected,
              team: teamInvited,
            }}
            onFinish={handleFinish}
          />
        )}
      </div>
    </div>
  );
}
