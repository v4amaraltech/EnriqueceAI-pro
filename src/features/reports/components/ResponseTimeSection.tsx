'use client';

import { Clock, Settings2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

import type { ResponseTimeData } from '../services/statistics.service';

interface ResponseTimeSectionProps {
  data: ResponseTimeData;
  onOpenIntervalModal: () => void;
}

function formatThreshold(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}min`;
}

export function ResponseTimeSection({ data, onOpenIntervalModal }: ResponseTimeSectionProps) {
  const threshold = formatThreshold(data.thresholdMinutes);

  return (
    <div className="space-y-4">
      {/* KPI Card */}
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
            <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold">{data.overallPct}%</p>
            <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              abordados em até {threshold} ({data.overallCount} de {data.totalLeads})
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onOpenIntervalModal}>
          <Settings2 className="mr-2 h-4 w-4" />
          {threshold}
        </Button>
      </div>

      {/* Table by cadence */}
      {data.byCadence.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
                <th className="px-4 py-2 text-left font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  Cadência
                </th>
                <th className="px-4 py-2 text-right font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  Leads Abordados
                </th>
                <th className="px-4 py-2 text-right font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  Em até {threshold}
                </th>
                <th className="px-4 py-2 text-right font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">%</th>
              </tr>
            </thead>
            <tbody>
              {data.byCadence.map((row) => (
                <tr key={row.cadenceId} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="px-4 py-2 font-medium">{row.cadenceName}</td>
                  <td className="px-4 py-2 text-right">{row.leadsApproached}</td>
                  <td className="px-4 py-2 text-right">{row.withinThreshold}</td>
                  <td className="px-4 py-2 text-right">
                    <span
                      className={
                        row.withinThresholdPct >= 80
                          ? 'text-green-600 dark:text-green-400'
                          : row.withinThresholdPct >= 50
                            ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-red-600 dark:text-red-400'
                      }
                    >
                      {row.withinThresholdPct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex h-32 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Nenhuma interação registrada no período.
        </div>
      )}
    </div>
  );
}
