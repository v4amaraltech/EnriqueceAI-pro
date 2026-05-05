'use client';

import { useState } from 'react';
import { Check, Sparkles } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';

import { formatLimit, isUnlimited } from '@/lib/utils/plan-limits';

import { formatCents } from '@/features/billing/services/feature-flags';
import type { PlanRow } from '@/features/billing/types';

interface OnboardingPlanStepProps {
  plans: PlanRow[];
  onSelect: (plan: PlanRow) => void;
  onBack: () => void;
}

export function OnboardingPlanStep({ plans, onSelect, onBack }: OnboardingPlanStepProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const selectedPlan = plans.find((p) => p.id === selected);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <Sparkles className="mx-auto h-10 w-10 text-[var(--primary)]" />
        <h1 className="mt-4 text-2xl font-bold">Escolha seu plano</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Comece com 14 dias grátis no Starter ou escolha um plano maior.
        </p>
      </div>

      <div className="grid gap-3">
        {plans.map((plan) => {
          const isSelected = selected === plan.id;
          const isStarter = plan.slug === 'starter';
          return (
            <Card
              key={plan.id}
              className={`cursor-pointer transition-all ${
                isSelected
                  ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]'
                  : 'hover:border-[var(--primary)]/50'
              }`}
              onClick={() => setSelected(plan.id)}
            >
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                      isSelected
                        ? 'border-[var(--primary)] bg-[var(--primary)]'
                        : 'border-[var(--muted-foreground)]'
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3 text-[var(--primary-foreground)]" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{plan.name}</span>
                      {isStarter && (
                        <Badge variant="secondary" className="text-xs">
                          14 dias grátis
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                      {isUnlimited(plan.max_leads) ? 'Leads ilimitados' : `${formatLimit(plan.max_leads)} leads`}
                      {' · '}
                      {isUnlimited(plan.max_ai_per_day) ? 'IA ilimitada' : `${plan.max_ai_per_day} IA/dia`}
                      {' · '}
                      {plan.included_users} usuários inclusos
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold">{formatCents(plan.price_cents)}</p>
                  <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">/mês</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          Voltar
        </Button>
        <Button
          onClick={() => selectedPlan && onSelect(selectedPlan)}
          disabled={!selectedPlan}
          className="flex-1"
        >
          Continuar
        </Button>
      </div>
    </div>
  );
}
