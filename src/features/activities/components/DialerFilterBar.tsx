'use client';

import { useMemo } from 'react';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';

export interface DialerFilterValues {
  lead: string;
  activity: string;
  step: string;
}

export const defaultDialerFilters: DialerFilterValues = {
  lead: 'all',
  activity: 'all',
  step: 'all',
};

interface DialerFilterBarProps {
  queue: DialerQueueItem[];
  filters: DialerFilterValues;
  onFiltersChange: (filters: DialerFilterValues) => void;
}

export function DialerFilterBar({ queue, filters, onFiltersChange }: DialerFilterBarProps) {
  const cadenceOptions = useMemo(
    () => [...new Set(queue.map((q) => q.cadenceName))].sort(),
    [queue],
  );

  const stepOptions = useMemo(
    () => [...new Set(queue.map((q) => String(q.stepOrder)))].sort((a, b) => Number(a) - Number(b)),
    [queue],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={filters.lead}
        onChange={(e) => onFiltersChange({ ...filters, lead: e.target.value })}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
      >
        <option value="all">Todos os leads</option>
        <option value="with_phone">Com telefone</option>
      </select>

      <select
        value={filters.activity}
        onChange={(e) => onFiltersChange({ ...filters, activity: e.target.value })}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
      >
        <option value="all">Todas as cadencias</option>
        {cadenceOptions.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      <select
        value={filters.step}
        onChange={(e) => onFiltersChange({ ...filters, step: e.target.value })}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
      >
        <option value="all">Qualquer passo</option>
        {stepOptions.map((s) => (
          <option key={s} value={s}>Passo {s}</option>
        ))}
      </select>
    </div>
  );
}

export function applyDialerFilters(
  queue: DialerQueueItem[],
  filters: DialerFilterValues,
): DialerQueueItem[] {
  return queue.filter((item) => {
    if (filters.lead === 'with_phone' && !item.phone) return false;
    if (filters.activity !== 'all' && item.cadenceName !== filters.activity) return false;
    if (filters.step !== 'all' && String(item.stepOrder) !== filters.step) return false;
    return true;
  });
}
