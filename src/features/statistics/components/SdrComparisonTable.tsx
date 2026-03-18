'use client';

import { useState } from 'react';

import { ArrowDown, ArrowUp } from 'lucide-react';

import { DeltaIndicator } from '@/shared/components/DeltaIndicator';
import { calculateDelta } from '@/shared/utils/comparison';

import type { SdrComparisonRow } from '../types/team-analytics.types';

interface SdrComparisonTableProps {
  data: SdrComparisonRow[];
  previousData?: SdrComparisonRow[];
}

type SortKey = keyof Omit<SdrComparisonRow, 'userId' | 'userName'>;

export function SdrComparisonTable({ data, previousData }: SdrComparisonTableProps) {
  const prevMap = new Map(previousData?.map((r) => [r.userId, r]));
  const [sortKey, setSortKey] = useState<SortKey>('activities');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Nenhum SDR encontrado.
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => {
    const diff = a[sortKey] - b[sortKey];
    return sortDir === 'desc' ? -diff : diff;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const columns: { key: SortKey; label: string }[] = [
    { key: 'leads', label: 'Leads' },
    { key: 'activities', label: 'Atividades' },
    { key: 'calls', label: 'Ligações' },
    { key: 'replies', label: 'Respostas' },
    { key: 'meetings', label: 'Reuniões' },
    { key: 'conversionRate', label: 'Conversão %' },
    { key: 'goalPercentage', label: 'Meta %' },
  ];

  const SortIcon = sortDir === 'desc' ? ArrowDown : ArrowUp;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
            <th className="px-4 py-2 text-left font-medium text-[var(--muted-foreground)]">SDR</th>
            {columns.map((col) => (
              <th
                key={col.key}
                className="cursor-pointer px-4 py-2 text-right font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                onClick={() => toggleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key && <SortIcon className="h-3 w-3" />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const prev = prevMap.get(row.userId);
            return (
              <tr key={row.userId} className="border-b border-[var(--border)]">
                <td className="px-4 py-2 font-medium">{row.userName}</td>
                <td className="px-4 py-2 text-right">
                  {row.leads}
                  {prev && <> <DeltaIndicator delta={calculateDelta(row.leads, prev.leads)} /></>}
                </td>
                <td className="px-4 py-2 text-right">
                  {row.activities}
                  {prev && <> <DeltaIndicator delta={calculateDelta(row.activities, prev.activities)} /></>}
                </td>
                <td className="px-4 py-2 text-right">{row.calls}</td>
                <td className="px-4 py-2 text-right">{row.replies}</td>
                <td className="px-4 py-2 text-right">{row.meetings}</td>
                <td className="px-4 py-2 text-right">
                  {row.conversionRate}%
                  {prev && <> <DeltaIndicator delta={calculateDelta(row.conversionRate, prev.conversionRate)} /></>}
                </td>
                <td className="px-4 py-2 text-right">
                  <GoalBadge percentage={row.goalPercentage} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GoalBadge({ percentage }: { percentage: number }) {
  let color = 'text-red-600 dark:text-red-400';
  if (percentage >= 100) color = 'text-green-600 dark:text-green-400';
  else if (percentage >= 70) color = 'text-yellow-600 dark:text-yellow-400';

  return <span className={`font-medium ${color}`}>{percentage}%</span>;
}
