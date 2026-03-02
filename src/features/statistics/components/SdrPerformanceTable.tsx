'use client';

import type { SdrPerformanceRow } from '../types/performance-analytics.types';

interface SdrPerformanceTableProps {
  data: SdrPerformanceRow[];
}

export function SdrPerformanceTable({ data }: SdrPerformanceTableProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Nenhum SDR com atividade no período.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs font-medium text-[var(--muted-foreground)]">
            <th className="pb-3 pr-4">#</th>
            <th className="pb-3 pr-4">SDR</th>
            <th className="pb-3 pr-4 text-right">Atividades</th>
            <th className="pb-3 pr-4 text-right">Leads Criados</th>
            <th className="pb-3 pr-4 text-right">Qualificados</th>
            <th className="pb-3 pr-4 text-right">Taxa %</th>
            <th className="pb-3 text-right">Reuniões</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr key={row.userId} className="border-b border-[var(--border)] last:border-0">
              <td className="py-3 pr-4 text-[var(--muted-foreground)]">{index + 1}</td>
              <td className="py-3 pr-4 font-medium">{row.userEmail}</td>
              <td className="py-3 pr-4 text-right">{row.activities}</td>
              <td className="py-3 pr-4 text-right">{row.leadsCreated}</td>
              <td className="py-3 pr-4 text-right">{row.qualified}</td>
              <td className="py-3 pr-4 text-right font-medium">{row.qualificationRate}%</td>
              <td className="py-3 text-right">{row.meetings}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
