'use client';

import type { CadencePerformanceRow } from '../types/cadence-analytics.types';

interface CadencePerformanceTableProps {
  data: CadencePerformanceRow[];
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  paused: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  archived: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativa',
  draft: 'Rascunho',
  paused: 'Pausada',
  archived: 'Arquivada',
};

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
};

const PRIORITY_LABEL: Record<string, string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

export function CadencePerformanceTable({ data }: CadencePerformanceTableProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Nenhuma cadência com inscritos no período.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs font-medium text-[var(--muted-foreground)]">
            <th className="pb-3 pr-4">Cadência</th>
            <th className="pb-3 pr-4">Status</th>
            <th className="pb-3 pr-4">Prioridade</th>
            <th className="pb-3 pr-4 text-right">Inscritos</th>
            <th className="pb-3 pr-4 text-right">Concluídos</th>
            <th className="pb-3 pr-4 text-right">Responderam</th>
            <th className="pb-3 text-right">Taxa %</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.cadenceId} className="border-b border-[var(--border)] last:border-0">
              <td className="py-3 pr-4 font-medium">{row.cadenceName}</td>
              <td className="py-3 pr-4">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status] ?? ''}`}>
                  {STATUS_LABEL[row.status] ?? row.status}
                </span>
              </td>
              <td className="py-3 pr-4">
                {row.priority ? (
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGE[row.priority] ?? ''}`}>
                    {PRIORITY_LABEL[row.priority] ?? row.priority}
                  </span>
                ) : (
                  <span className="text-xs text-[var(--muted-foreground)]">—</span>
                )}
              </td>
              <td className="py-3 pr-4 text-right">{row.enrolled}</td>
              <td className="py-3 pr-4 text-right">{row.completed}</td>
              <td className="py-3 pr-4 text-right">{row.replied}</td>
              <td className="py-3 text-right font-medium">{row.rate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
