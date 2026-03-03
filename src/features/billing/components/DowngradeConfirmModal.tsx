'use client';

import { useEffect, useTransition, useState } from 'react';
import { AlertTriangle, ArrowRight, X as XIcon } from 'lucide-react';
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
import { fetchDowngradeWarnings } from '../actions/fetch-downgrade-warnings';
import { formatCents, getPlanDiff } from '../services/feature-flags';
import type { PlanRow } from '../types';

interface DowngradeConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan: PlanRow;
  targetPlan: PlanRow;
}

export function DowngradeConfirmModal({
  open,
  onOpenChange,
  currentPlan,
  targetPlan,
}: DowngradeConfirmModalProps) {
  const [isPending, startTransition] = useTransition();
  // null = loading/not fetched, [] = no warnings, [...] = has warnings
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const diff = getPlanDiff(currentPlan, targetPlan);
  const loadingWarnings = open && warnings === null;

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      setWarnings(null);
    }
    onOpenChange(isOpen);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchDowngradeWarnings(targetPlan)
      .then((result) => {
        if (!cancelled) {
          setWarnings(result.success ? result.data.warnings : []);
        }
      });
    return () => { cancelled = true; };
  }, [open, targetPlan]);

  function handleConfirm() {
    startTransition(async () => {
      const result = await createCheckoutSession(targetPlan.id);
      if (!result.success) {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirmar downgrade</DialogTitle>
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

          {/* Warnings */}
          {loadingWarnings && (
            <p className="text-sm text-[var(--muted-foreground)]">Verificando compatibilidade...</p>
          )}
          {warnings && warnings.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
              {warnings.map((warning) => (
                <div key={warning} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <span className="text-amber-800 dark:text-amber-200">{warning}</span>
                </div>
              ))}
            </div>
          )}

          {/* Lost features */}
          {diff.lost.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">Funcionalidades perdidas:</p>
              <ul className="space-y-1.5">
                {diff.lost.map((item) => (
                  <li key={item.name} className="flex items-start gap-2 text-sm">
                    <XIcon className="mt-0.5 size-4 shrink-0 text-red-500" />
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
              <p className="mb-2 text-sm font-medium">Limites reduzidos:</p>
              <ul className="space-y-1 text-sm">
                {diff.limitsChanged.map((limit) => (
                  <li key={limit.name} className="flex items-center gap-2">
                    <ArrowRight className="size-4 shrink-0 text-[var(--muted-foreground)]" />
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
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? 'Redirecionando...' : 'Confirmar downgrade'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
