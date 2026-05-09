'use client';

import type { CadenceConversionRow } from '../types/conversion-analytics.types';

interface ConversionByCadenceTableProps {
  data: CadenceConversionRow[];
}

export function ConversionByCadenceTable({ data }: ConversionByCadenceTableProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhuma cadência com enrollments no período.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
            <th className="px-4 py-2 text-left font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Cadência</th>
            <th className="px-4 py-2 text-center font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Inscritos</th>
            <th className="px-4 py-2 text-center font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Reuniões</th>
            <th className="px-4 py-2 text-center font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Qualificados</th>
            <th className="px-4 py-2 text-center font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Taxa %</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.cadenceId} className="border-b border-[var(--border)]">
              <td className="px-4 py-2 font-medium">{row.cadenceName}</td>
              <td className="px-4 py-2 text-center">{row.enrollments}</td>
              <td className="px-4 py-2 text-center">{row.meetings}</td>
              <td className="px-4 py-2 text-center">{row.qualified}</td>
              <td className="px-4 py-2 text-right font-medium">
                <span className={row.conversionRate >= 20 ? 'text-green-600 dark:text-green-400' : ''}>
                  {row.conversionRate}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
