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

  const totals = data.reduce(
    (acc, row) => ({
      enrollments: acc.enrollments + row.enrollments,
      contacted: acc.contacted + row.contacted,
      qualified: acc.qualified + row.qualified,
      won: acc.won + row.won,
    }),
    { enrollments: 0, contacted: 0, qualified: 0, won: 0 },
  );
  const totalRate = totals.enrollments > 0
    ? Math.round((totals.won / totals.enrollments) * 1000) / 10
    : 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
            <th className="px-4 py-2 text-left font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Cadência</th>
            <th className="px-4 py-2 text-center font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Inscritos</th>
            <th className="px-4 py-2 text-center font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Em Contato</th>
            <th className="px-4 py-2 text-center font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Qualificado</th>
            <th className="px-4 py-2 text-center font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Ganho</th>
            <th className="px-4 py-2 text-center font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Taxa %</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.cadenceId} className="border-b border-[var(--border)]">
              <td className="px-4 py-2 font-medium">{row.cadenceName}</td>
              <td className="px-4 py-2 text-center">{row.enrollments}</td>
              <td className="px-4 py-2 text-center">{row.contacted}</td>
              <td className="px-4 py-2 text-center">{row.qualified}</td>
              <td className="px-4 py-2 text-center">{row.won}</td>
              <td className="px-4 py-2 text-right font-medium">
                <span className={row.conversionRate >= 20 ? 'text-green-600 dark:text-green-400' : ''}>
                  {row.conversionRate}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[var(--border)] bg-[var(--muted)]/50 font-semibold">
            <td className="px-4 py-2">Total</td>
            <td className="px-4 py-2 text-center">{totals.enrollments}</td>
            <td className="px-4 py-2 text-center">{totals.contacted}</td>
            <td className="px-4 py-2 text-center">{totals.qualified}</td>
            <td className="px-4 py-2 text-center">{totals.won}</td>
            <td className="px-4 py-2 text-right">
              <span className={totalRate >= 20 ? 'text-green-600 dark:text-green-400' : ''}>
                {totalRate}%
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
