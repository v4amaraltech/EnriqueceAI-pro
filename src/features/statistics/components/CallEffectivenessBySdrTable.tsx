'use client';

import type { SdrEffectivenessRow } from '../types/call-statistics.types';

interface CallEffectivenessBySdrTableProps {
  data: SdrEffectivenessRow[];
}

export function CallEffectivenessBySdrTable({ data }: CallEffectivenessBySdrTableProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhuma ligação no período.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            <th className="pb-3 pr-4">SDR</th>
            <th className="pb-3 pr-4 text-right">Ligações</th>
            <th className="pb-3 pr-4 text-right">Atendidas</th>
            <th className="pb-3 pr-4 text-right">Conversas relevantes</th>
            <th className="pb-3 pr-4 text-right">% relevantes</th>
            <th className="pb-3 text-right">Sem desfecho (discador)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.userId} className="border-b border-[var(--border)] last:border-0">
              <td className="py-3 pr-4 font-medium">{row.userName}</td>
              <td className="py-3 pr-4 text-right">{row.totalCalls}</td>
              <td className="py-3 pr-4 text-right">{row.answeredCalls}</td>
              <td className="py-3 pr-4 text-right">{row.relevantCalls}</td>
              <td className="py-3 pr-4 text-right font-medium">{row.relevantRate}%</td>
              <td className="py-3 text-right">
                {row.withoutDispositionCalls}{' '}
                <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  ({row.withoutDispositionRate}%)
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
