'use client';

import { DeltaIndicator } from '@/shared/components/DeltaIndicator';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { calculateDelta } from '@/shared/utils/comparison';

import type { SdrMetrics } from '../reports.contract';

interface SdrReportProps {
  metrics: SdrMetrics[];
  previousMetrics?: SdrMetrics[];
  onRowClick?: (userId: string) => void;
}

export function SdrReport({ metrics, previousMetrics, onRowClick }: SdrReportProps) {
  const prevMap = new Map(previousMetrics?.map((m) => [m.userId, m]));
  if (metrics.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Nenhum SDR com atividade no período selecionado.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Performance por SDR</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  <th className="pb-2 pr-4 font-medium">SDR</th>
                  <th className="pb-2 pr-4 text-right font-medium">Leads</th>
                  <th className="pb-2 pr-4 text-right font-medium">Mensagens</th>
                  <th className="pb-2 pr-4 text-right font-medium">Respostas</th>
                  <th className="pb-2 pr-4 text-right font-medium">Reuniões</th>
                  <th className="pb-2 text-right font-medium">Conversão</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => {
                  const prev = prevMap.get(m.userId);
                  return (
                    <tr
                      key={m.userId}
                      className={`border-b border-[var(--border)] last:border-0 ${onRowClick ? 'cursor-pointer transition-colors hover:bg-[var(--accent)]' : ''}`}
                      onClick={() => onRowClick?.(m.userId)}
                    >
                      <td className="py-2 pr-4 font-medium">{m.userName}</td>
                      <td className="py-2 pr-4 text-right">
                        <span>{m.leadsWorked}</span>
                        {prev && <> <DeltaIndicator delta={calculateDelta(m.leadsWorked, prev.leadsWorked)} /></>}
                      </td>
                      <td className="py-2 pr-4 text-right">{m.messagesSent}</td>
                      <td className="py-2 pr-4 text-right">
                        <span>{m.replies}</span>
                        {prev && <> <DeltaIndicator delta={calculateDelta(m.replies, prev.replies)} /></>}
                      </td>
                      <td className="py-2 pr-4 text-right">{m.meetings}</td>
                      <td className="py-2 text-right font-medium">
                        <span>{m.conversionRate}%</span>
                        {prev && <> <DeltaIndicator delta={calculateDelta(m.conversionRate, prev.conversionRate)} /></>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Comparison bars */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comparativo de Desempenho</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {metrics.map((m) => {
              const maxMessages = Math.max(...metrics.map((s) => s.messagesSent), 1);
              return (
                <div key={m.userId} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{m.userName}</span>
                    <span className="text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                      {m.messagesSent} msgs | {m.replies} respostas | {m.meetings} reuniões
                    </span>
                  </div>
                  <div className="h-4 w-full rounded-md bg-[var(--muted)]">
                    <div
                      className="h-full rounded-md bg-red-500 transition-all"
                      style={{ width: `${(m.messagesSent / maxMessages) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
