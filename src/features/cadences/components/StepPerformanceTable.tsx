'use client';

import { Badge } from '@/shared/components/ui/badge';
import { CHANNEL_COLORS, CHANNEL_LABELS } from '@/shared/constants/chart-colors';

import type { StepPerformanceMetrics } from '../cadences.contract';

interface StepPerformanceTableProps {
  steps: StepPerformanceMetrics[];
}

export function StepPerformanceTable({ steps }: StepPerformanceTableProps) {
  if (steps.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">
        Nenhuma etapa cadastrada.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
            <th className="pb-2 pr-3 font-medium">#</th>
            <th className="pb-2 pr-3 font-medium">Canal</th>
            <th className="pb-2 pr-3 font-medium">Nome</th>
            <th className="pb-2 pr-3 text-right font-medium">Enviados</th>
            <th className="pb-2 pr-3 text-right font-medium">Abertos</th>
            <th className="pb-2 pr-3 text-right font-medium">Respond.</th>
            <th className="pb-2 pr-3 text-right font-medium">Bounce</th>
            <th className="pb-2 pr-3 text-right font-medium">Abertura</th>
            <th className="pb-2 pr-3 text-right font-medium">Resposta</th>
            <th className="pb-2 text-right font-medium">Bounce%</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => (
            <tr key={s.stepId} className="border-b border-[var(--border)] last:border-0">
              <td className="py-2 pr-3">{s.stepOrder}</td>
              <td className="py-2 pr-3">
                <Badge
                  variant="outline"
                  style={{ borderColor: CHANNEL_COLORS[s.channel] ?? '#6b7280', color: CHANNEL_COLORS[s.channel] ?? '#6b7280' }}
                >
                  {CHANNEL_LABELS[s.channel] ?? s.channel}
                </Badge>
              </td>
              <td className="py-2 pr-3">
                <span className="font-medium">{s.activityName ?? `Etapa ${s.stepOrder}`}</span>
                {s.abEnabled && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">
                    A/B
                  </Badge>
                )}
                {s.abWinnerVariant && (
                  <Badge className="ml-1 bg-green-100 text-[10px] text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    Vencedor: {s.abWinnerVariant}
                  </Badge>
                )}
              </td>
              <td className="py-2 pr-3 text-right">{s.sent}</td>
              <td className="py-2 pr-3 text-right">{s.opened}</td>
              <td className="py-2 pr-3 text-right">{s.replied}</td>
              <td className="py-2 pr-3 text-right">{s.bounced}</td>
              <td className="py-2 pr-3 text-right">{s.openRate}%</td>
              <td className="py-2 pr-3 text-right">{s.replyRate}%</td>
              <td className="py-2 text-right">{s.bounceRate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
