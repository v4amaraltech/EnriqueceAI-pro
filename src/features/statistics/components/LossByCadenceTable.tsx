'use client';

import type { LossByCadenceRow } from '../types/loss-reason-analytics.types';

interface LossByCadenceTableProps {
  data: LossByCadenceRow[];
}

export function LossByCadenceTable({ data }: LossByCadenceTableProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Nenhuma cadência com perdas no período.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs font-medium text-[var(--muted-foreground)]">
            <th className="pb-3 pr-4">Cadência</th>
            <th className="pb-3 pr-4 text-right">Inscritos</th>
            <th className="pb-3 pr-4 text-right">Perdidos</th>
            <th className="pb-3 pr-4 text-right">Taxa de Perda</th>
            <th className="pb-3">Motivo Principal</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.cadenceId} className="border-b border-[var(--border)] last:border-0">
              <td className="py-3 pr-4 font-medium">{row.cadenceName}</td>
              <td className="py-3 pr-4 text-right">{row.enrolled}</td>
              <td className="py-3 pr-4 text-right">{row.lost}</td>
              <td className="py-3 pr-4 text-right font-medium">{row.lossRate}%</td>
              <td className="py-3 text-sm text-[var(--muted-foreground)]">{row.topReason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
