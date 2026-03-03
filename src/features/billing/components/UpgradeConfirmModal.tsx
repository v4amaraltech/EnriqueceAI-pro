'use client';

import { useTransition } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import { createCheckoutSession } from '../actions/create-checkout';
import { formatCents, getPlanDiff } from '../services/feature-flags';
import type { PlanRow } from '../types';

interface UpgradeConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan: PlanRow;
  targetPlan: PlanRow;
}

export function UpgradeConfirmModal({
  open,
  onOpenChange,
  currentPlan,
  targetPlan,
}: UpgradeConfirmModalProps) {
  const [isPending, startTransition] = useTransition();
  const diff = getPlanDiff(currentPlan, targetPlan);

  function handleConfirm() {
    startTransition(async () => {
      const result = await createCheckoutSession(targetPlan.id);
      if (!result.success) {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirmar upgrade</DialogTitle>
          <DialogDescription>
            Você está mudando de <strong>{currentPlan.name}</strong> para{' '}
            <strong>{targetPlan.name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Price change */}
          <div className="flex items-center justify-center gap-3 rounded-lg bg-[var(--muted)] p-3">
            <span className="text-sm text-[var(--muted-foreground)]">
              {formatCents(currentPlan.price_cents)}/mês
            </span>
            <ArrowRight className="size-4 text-[var(--muted-foreground)]" />
            <span className="text-lg font-semibold">
              {formatCents(targetPlan.price_cents)}/mês
            </span>
          </div>

          {/* Gained features */}
          {diff.gained.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">Novas funcionalidades:</p>
              <ul className="space-y-1.5">
                {diff.gained.map((item) => (
                  <li key={item.name} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-green-500" />
                    <div>
                      <span className="font-medium">{item.name}</span>
                      <span className="text-[var(--muted-foreground)]"> — {item.description}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Limit changes */}
          {diff.limitsChanged.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">Limites ampliados:</p>
              <ul className="space-y-1 text-sm">
                {diff.limitsChanged.map((limit) => (
                  <li key={limit.name} className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-green-500" />
                    <span>
                      {limit.name}: {limit.from} → <strong>{limit.to}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={isPending}>
            {isPending ? 'Redirecionando...' : 'Confirmar upgrade'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
