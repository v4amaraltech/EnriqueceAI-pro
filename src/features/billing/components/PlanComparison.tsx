'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';

import { formatLimit, isUnlimited } from '@/lib/utils/plan-limits';

import { formatCents } from '../services/feature-flags';
import type { PlanComparison as PlanComparisonData, PlanRow } from '../types';

import { DowngradeConfirmModal } from './DowngradeConfirmModal';
import { UpgradeConfirmModal } from './UpgradeConfirmModal';

interface PlanComparisonProps {
  data: PlanComparisonData;
}

export function PlanComparisonView({ data }: PlanComparisonProps) {
  const { plans, currentPlanSlug } = data;
  const currentPlan = plans.find((p) => p.slug === currentPlanSlug);

  const [upgradeTarget, setUpgradeTarget] = useState<PlanRow | null>(null);
  const [downgradeTarget, setDowngradeTarget] = useState<PlanRow | null>(null);

  function handlePlanClick(plan: PlanRow) {
    if (!currentPlan || plan.slug === currentPlanSlug) return;

    if (plan.price_cents > currentPlan.price_cents) {
      setUpgradeTarget(plan);
    } else {
      setDowngradeTarget(plan);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Comparação de Planos</h2>
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Escolha o plano ideal para sua equipe
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isCurrent={plan.slug === currentPlanSlug}
            onSelect={() => handlePlanClick(plan)}
            isUpgrade={currentPlan ? plan.price_cents > currentPlan.price_cents : false}
          />
        ))}
      </div>

      {currentPlan && upgradeTarget && (
        <UpgradeConfirmModal
          open
          onOpenChange={(open) => { if (!open) setUpgradeTarget(null); }}
          currentPlan={currentPlan}
          targetPlan={upgradeTarget}
        />
      )}

      {currentPlan && downgradeTarget && (
        <DowngradeConfirmModal
          open
          onOpenChange={(open) => { if (!open) setDowngradeTarget(null); }}
          currentPlan={currentPlan}
          targetPlan={downgradeTarget}
        />
      )}
    </div>
  );
}

interface PlanCardProps {
  plan: PlanRow;
  isCurrent: boolean;
  onSelect: () => void;
  isUpgrade: boolean;
}

function PlanCard({ plan, isCurrent, onSelect, isUpgrade }: PlanCardProps) {
  const aiUnlimited = isUnlimited(plan.max_ai_per_day);
  const leadsUnlimited = isUnlimited(plan.max_leads);
  const waUnlimited = isUnlimited(plan.max_whatsapp_per_month);

  return (
    <Card className={isCurrent ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{plan.name}</CardTitle>
          {isCurrent && <Badge variant="default">Atual</Badge>}
        </div>
        <div className="mt-2">
          <span className="text-2xl font-bold">{formatCents(plan.price_cents)}</span>
          <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">/mês</span>
        </div>
        {plan.additional_user_price_cents > 0 && (
          <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            + {formatCents(plan.additional_user_price_cents)} por usuário adicional
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2 text-sm">
          <PlanFeatureRow label={leadsUnlimited ? 'Leads ilimitados' : `${formatLimit(plan.max_leads)} leads`} included />
          <PlanFeatureRow
            label={aiUnlimited ? 'IA ilimitada' : `${plan.max_ai_per_day} IA/dia`}
            included
          />
          <PlanFeatureRow
            label={waUnlimited ? 'WhatsApp ilimitado' : `${formatLimit(plan.max_whatsapp_per_month)} WhatsApp/mês`}
            included
          />
          <PlanFeatureRow
            label={`${plan.included_users} usuário${plan.included_users > 1 ? 's' : ''} inclusos`}
            included
          />
          <PlanFeatureRow
            label={`Enriquecimento ${plan.features.enrichment === 'full' ? 'completo' : plan.features.enrichment === 'lemit' ? 'intermediário' : 'básico'}`}
            included
          />
          <PlanFeatureRow label="CRM" included={plan.features.crm} />
          <PlanFeatureRow label="Calendário" included={plan.features.calendar} />
        </div>

        <Button
          variant={isCurrent ? 'outline' : 'default'}
          className="w-full"
          disabled={isCurrent}
          onClick={isCurrent ? undefined : onSelect}
        >
          {isCurrent
            ? 'Plano atual'
            : isUpgrade
              ? 'Fazer upgrade'
              : 'Mudar plano'}
        </Button>
      </CardContent>
    </Card>
  );
}

interface PlanFeatureRowProps {
  label: string;
  included: boolean;
}

function PlanFeatureRow({ label, included }: PlanFeatureRowProps) {
  return (
    <div className="flex items-center gap-2">
      {included ? (
        <Check className="size-4 text-green-500" />
      ) : (
        <X className="size-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
      )}
      <span className={included ? '' : 'text-[var(--muted-foreground)] dark:text-[var(--foreground)]'}>{label}</span>
    </div>
  );
}
