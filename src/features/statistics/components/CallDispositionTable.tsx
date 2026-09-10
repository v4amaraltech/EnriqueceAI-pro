'use client';

import type { DispositionBreakdownRow } from '../types/call-statistics.types';

interface CallDispositionTableProps {
  data: DispositionBreakdownRow[];
}

export function CallDispositionTable({ data }: CallDispositionTableProps) {
  if (data.every((row) => row.count === 0)) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhuma ligação no período.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            <th className="pb-3 pr-4">Desfecho marcado pelo SDR</th>
            <th className="pb-3 pr-4 text-right">Ligações</th>
            <th className="pb-3 text-right">% do total</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const isMissing = row.key === 'none';
            const isExternal = row.key === 'external';
            return (
              <tr
                key={row.key}
                className={`border-b border-[var(--border)] last:border-0 ${isMissing ? 'font-semibold' : ''} ${isExternal ? 'text-[var(--muted-foreground)] dark:text-[var(--foreground)]' : ''}`}
              >
                <td className="py-2.5 pr-4">{row.label}</td>
                <td className="py-2.5 pr-4 text-right">{row.count}</td>
                <td className="py-2.5 text-right">{row.percentage}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
