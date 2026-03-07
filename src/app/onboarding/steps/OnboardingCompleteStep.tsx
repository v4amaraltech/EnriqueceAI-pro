'use client';

import { Check, Minus, Rocket } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

interface OnboardingCompleteStepProps {
  completedItems: {
    company: boolean;
    plan: boolean;
    payment: boolean;
    gmail: boolean;
    team: boolean;
  };
  onFinish: () => void;
}

const CHECKLIST = [
  { key: 'company' as const, label: 'Empresa configurada' },
  { key: 'plan' as const, label: 'Plano selecionado' },
  { key: 'payment' as const, label: 'Pagamento configurado' },
  { key: 'gmail' as const, label: 'Gmail conectado' },
  { key: 'team' as const, label: 'Equipe convidada' },
];

export function OnboardingCompleteStep({ completedItems, onFinish }: OnboardingCompleteStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <Rocket className="mx-auto h-10 w-10 text-[var(--primary)]" />
        <h1 className="mt-4 text-2xl font-bold">Tudo Pronto!</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Sua organização está configurada. Veja o que foi feito:
        </p>
      </div>

      <div className="space-y-2">
        {CHECKLIST.map((item) => {
          const done = completedItems[item.key];
          return (
            <div
              key={item.key}
              className={`flex items-center gap-3 rounded-md border px-4 py-3 text-sm ${
                done
                  ? 'border-green-200 bg-green-50 dark:border-green-800/50 dark:bg-green-900/20'
                  : 'border-[var(--border)] text-[var(--muted-foreground)]'
              }`}
            >
              {done ? (
                <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <Minus className="h-4 w-4 text-[var(--muted-foreground)]" />
              )}
              <span className={done ? 'font-medium' : ''}>{item.label}</span>
              {!done && (
                <span className="ml-auto text-xs">Pode configurar depois</span>
              )}
            </div>
          );
        })}
      </div>

      <Button onClick={onFinish} className="w-full">
        Ir para o Dashboard
      </Button>
    </div>
  );
}
