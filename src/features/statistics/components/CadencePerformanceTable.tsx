'use client';

import { useCallback, useState, useTransition } from 'react';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

import { fetchStepAnalytics } from '../actions/fetch-step-analytics';
import type { CadencePerformanceRow } from '../types/cadence-analytics.types';
import type { CadenceStepAnalyticsData } from '../types/step-analytics';
import { CadenceStepTable } from './CadenceStepTable';

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
  const searchParams = useSearchParams();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [stepCache, setStepCache] = useState<Map<string, CadenceStepAnalyticsData>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  // Reset cache when filters change (React pattern: adjust state during render)
  const paramsKey = searchParams.toString();
  const [prevParamsKey, setPrevParamsKey] = useState(paramsKey);

  if (paramsKey !== prevParamsKey) {
    setPrevParamsKey(paramsKey);
    setStepCache(new Map());
    setExpandedIds(new Set());
  }

  const handleRowClick = useCallback((cadenceId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cadenceId)) {
        next.delete(cadenceId);
      } else {
        next.add(cadenceId);
        // Fetch step data if not cached
        if (!stepCache.has(cadenceId)) {
          setLoadingIds((prev) => new Set(prev).add(cadenceId));
          const from = searchParams.get('from') ?? undefined;
          const to = searchParams.get('to') ?? undefined;
          const user = searchParams.get('user') ?? undefined;
          const dateRange = from && to ? { from, to } : undefined;
          const userIds = user ? [user] : undefined;

          startTransition(async () => {
            const result = await fetchStepAnalytics(cadenceId, '30d', userIds, dateRange);
            if (result.success) {
              setStepCache((prev) => new Map(prev).set(cadenceId, result.data));
            }
            setLoadingIds((prev) => {
              const next = new Set(prev);
              next.delete(cadenceId);
              return next;
            });
          });
        }
      }
      return next;
    });
  }, [searchParams, stepCache, startTransition]);

  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhuma cadência com inscritos no período.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
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
          {data.map((row) => {
            const isExpanded = expandedIds.has(row.cadenceId);
            const isLoading = loadingIds.has(row.cadenceId) || isPending;
            const cachedData = stepCache.get(row.cadenceId);

            return (
              <CadenceRow
                key={row.cadenceId}
                row={row}
                isExpanded={isExpanded}
                isLoading={isLoading}
                stepData={cachedData}
                onToggle={handleRowClick}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface CadenceRowProps {
  row: CadencePerformanceRow;
  isExpanded: boolean;
  isLoading: boolean;
  stepData?: CadenceStepAnalyticsData;
  onToggle: (cadenceId: string) => void;
}

function CadenceRow({ row, isExpanded, isLoading, stepData, onToggle }: CadenceRowProps) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-[var(--border)] transition-colors hover:bg-[var(--muted)]/50 last:border-0"
        onClick={() => onToggle(row.cadenceId)}
      >
        <td className="py-3 pr-4 font-medium">
          <span className="inline-flex items-center gap-1.5">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
            )}
            {row.cadenceName}
          </span>
        </td>
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
            <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">—</span>
          )}
        </td>
        <td className="py-3 pr-4 text-right">{row.enrolled}</td>
        <td className="py-3 pr-4 text-right">{row.completed}</td>
        <td className="py-3 pr-4 text-right">{row.replied}</td>
        <td className="py-3 text-right font-medium">{row.rate}%</td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7} className="bg-[var(--muted)]/30 px-6 py-3">
            <CadenceStepTable
              steps={stepData?.steps ?? []}
              isLoading={isLoading && !stepData}
            />
          </td>
        </tr>
      )}
    </>
  );
}
