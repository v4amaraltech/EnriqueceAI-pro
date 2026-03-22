'use client';

import { Skeleton } from '@/shared/components/ui/skeleton';

import type { CadenceStepMetrics } from '../types/step-analytics';

interface CadenceStepTableProps {
  steps: CadenceStepMetrics[];
  isLoading: boolean;
}

const CHANNEL_LABEL: Record<string, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  phone: 'Telefone',
  linkedin: 'LinkedIn',
  research: 'Pesquisa',
  crm: 'CRM',
};

function RateCell({ count, rate }: { count: number; rate: number }) {
  return (
    <span>
      {count}{' '}
      <span className="text-[var(--muted-foreground)]">({rate}%)</span>
    </span>
  );
}

export function CadenceStepTable({ steps, isLoading }: CadenceStepTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2 py-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhum step cadastrado nesta cadência.
      </div>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-[var(--border)] text-left font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          <th className="pb-2 pr-3">Passo</th>
          <th className="pb-2 pr-3">Atividade</th>
          <th className="pb-2 pr-3 text-right">Enviados</th>
          <th className="pb-2 pr-3 text-right">Abertos (%)</th>
          <th className="pb-2 pr-3 text-right">Clicados (%)</th>
          <th className="pb-2 pr-3 text-right">Respondidos (%)</th>
          <th className="pb-2 text-right">Reuniões</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((step) => (
          <tr key={step.stepId} className="border-b border-[var(--border)] last:border-0">
            <td className="py-2 pr-3 font-medium">#{step.stepOrder}</td>
            <td className="py-2 pr-3">
              <span className="font-medium">{CHANNEL_LABEL[step.channel] ?? step.channel}</span>
              {step.activityName && (
                <span className="ml-1 text-[var(--muted-foreground)]">— {step.activityName}</span>
              )}
            </td>
            <td className="py-2 pr-3 text-right">{step.sent}</td>
            <td className="py-2 pr-3 text-right">
              <RateCell count={step.opened} rate={step.openRate} />
            </td>
            <td className="py-2 pr-3 text-right">
              <RateCell count={step.clicked} rate={step.clickRate} />
            </td>
            <td className="py-2 pr-3 text-right">
              <RateCell count={step.replied} rate={step.replyRate} />
            </td>
            <td className="py-2 text-right">{step.meetingScheduled}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
