'use client';

import { useTransition } from 'react';
import { CreditCard, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';

import { createPortalSession } from '../actions/create-portal';
import type { PaymentMethodInfo } from '../actions/fetch-payment-method';

interface PaymentMethodProps {
  method: PaymentMethodInfo | null;
  hasStripeSubscription: boolean;
}

function brandLabel(brand: string): string {
  const brands: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    elo: 'Elo',
    hipercard: 'Hipercard',
  };
  return brands[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

export function PaymentMethod({ method, hasStripeSubscription }: PaymentMethodProps) {
  const [isPending, startTransition] = useTransition();

  function handleManagePayment() {
    startTransition(async () => {
      const result = await createPortalSession();
      if (!result.success) {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="size-4" />
          Método de Pagamento
        </CardTitle>
      </CardHeader>
      <CardContent>
        {method ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--muted)]">
                <CreditCard className="size-5 text-[var(--muted-foreground)]" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  {brandLabel(method.brand)} •••• {method.last4}
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Expira {String(method.expMonth).padStart(2, '0')}/{method.expYear}
                </p>
              </div>
            </div>
            {hasStripeSubscription && (
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={handleManagePayment}
              >
                <ExternalLink className="mr-1.5 size-3.5" />
                {isPending ? 'Abrindo...' : 'Gerenciar'}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CreditCard className="size-8 text-[var(--muted-foreground)]" />
            <p className="text-sm text-[var(--muted-foreground)]">
              Nenhum método de pagamento cadastrado
            </p>
            {hasStripeSubscription && (
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={handleManagePayment}
              >
                <ExternalLink className="mr-1.5 size-3.5" />
                {isPending ? 'Abrindo...' : 'Adicionar pagamento'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
