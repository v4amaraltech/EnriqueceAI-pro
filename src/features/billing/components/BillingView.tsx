'use client';

import { useTransition } from 'react';
import { Check, CreditCard, ExternalLink, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';

import { formatLimit, isUnlimited } from '@/lib/utils/plan-limits';

import { createPortalSession } from '../actions/create-portal';
import { formatCents } from '../services/feature-flags';
import type { BillingOverview } from '../types';

interface BillingViewProps {
  data: BillingOverview;
}

function statusLabel(status: string): { label: string; variant: 'default' | 'secondary' | 'destructive' } {
  switch (status) {
    case 'active':
      return { label: 'Ativa', variant: 'default' };
    case 'past_due':
      return { label: 'Pagamento pendente', variant: 'destructive' };
    case 'canceled':
      return { label: 'Cancelada', variant: 'destructive' };
    default:
      return { label: status, variant: 'secondary' };
  }
}

export function BillingView({ data }: BillingViewProps) {
  const { plan, subscription, memberCount, additionalUsers, monthlyTotal } = data;
  const status = statusLabel(subscription.status);
  const aiUnlimited = isUnlimited(plan.max_ai_per_day);
  const leadsUnlimited = isUnlimited(plan.max_leads);
  const waUnlimited = isUnlimited(plan.max_whatsapp_per_month);
  const hasStripeSubscription = !!subscription.stripe_subscription_id;

  const [isPending, startTransition] = useTransition();

  function handleManageSubscription() {
    startTransition(async () => {
      const result = await createPortalSession();
      if (!result.success) {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="size-4" />
            Plano Atual
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-semibold">{plan.name}</p>
              <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                {formatCents(plan.price_cents)}/mês
                {additionalUsers > 0 && (
                  <span>
                    {' '}+ {additionalUsers} usuário{additionalUsers > 1 ? 's' : ''} adicional
                    ({formatCents(additionalUsers * plan.additional_user_price_cents)})
                  </span>
                )}
              </p>
            </div>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>

          <div className="rounded-lg bg-[var(--muted)] p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Total mensal</span>
              <span className="font-semibold">{formatCents(monthlyTotal)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Período atual</p>
              <p className="font-medium">
                {new Date(subscription.current_period_start).toLocaleDateString('pt-BR')} —{' '}
                {new Date(subscription.current_period_end).toLocaleDateString('pt-BR')}
              </p>
            </div>
            <div>
              <p className="text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Membros</p>
              <p className="font-medium">
                {memberCount} de {plan.included_users} inclusos
              </p>
            </div>
          </div>

          {hasStripeSubscription && (
            <Button
              variant="outline"
              className="w-full"
              disabled={isPending}
              onClick={handleManageSubscription}
            >
              <ExternalLink className="mr-2 size-4" />
              {isPending ? 'Abrindo portal...' : 'Gerenciar Assinatura'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Features */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" />
            Recursos do Plano
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <FeatureItem label="Leads" value={leadsUnlimited ? 'Ilimitado' : `Até ${formatLimit(plan.max_leads)}`} />
            <FeatureItem
              label="IA por dia"
              value={aiUnlimited ? 'Ilimitado' : `${plan.max_ai_per_day} gerações`}
            />
            <FeatureItem
              label="WhatsApp por mês"
              value={waUnlimited ? 'Ilimitado' : `${formatLimit(plan.max_whatsapp_per_month)} mensagens`}
            />
            <FeatureItem
              label="Usuários inclusos"
              value={`${plan.included_users} usuário${plan.included_users > 1 ? 's' : ''}`}
            />
            <FeatureItem
              label="Enriquecimento"
              value={plan.features.enrichment === 'full' ? 'Completo' : plan.features.enrichment === 'lemit' ? 'Intermediário' : 'Básico'}
            />
            <FeatureItem label="CRM" value={plan.features.crm ? 'Incluído' : 'Não incluído'} enabled={plan.features.crm} />
            <FeatureItem label="Calendário" value={plan.features.calendar ? 'Incluído' : 'Não incluído'} enabled={plan.features.calendar} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface FeatureItemProps {
  label: string;
  value: string;
  enabled?: boolean;
}

function FeatureItem({ label, value, enabled }: FeatureItemProps) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{label}</span>
      <span className="flex items-center gap-1 font-medium">
        {enabled !== undefined && (
          <Check className={`size-3.5 ${enabled ? 'text-green-500' : 'text-[var(--muted-foreground)] dark:text-[var(--foreground)]'}`} />
        )}
        {value}
      </span>
    </div>
  );
}
