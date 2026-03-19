'use client';

import { useCallback, useState, useTransition } from 'react';

import { getDrilldownConfig } from '@/shared/components/drilldown/drilldown-columns';
import type {
  DrilldownColumn,
  DrilldownFilters,
  DrilldownMetric,
  DrilldownRow,
  DrilldownState,
} from '@/shared/components/drilldown/drilldown.types';
import { fetchDrilldownData } from '@/shared/actions/fetch-drilldown-data';

export function useDrilldown(): DrilldownState {
  const [isOpen, setIsOpen] = useState(false);
  const [metric, setMetric] = useState<DrilldownMetric | null>(null);
  const [filters, setFilters] = useState<DrilldownFilters | null>(null);
  const [data, setData] = useState<DrilldownRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [title, setTitle] = useState('');
  const [columns, setColumns] = useState<DrilldownColumn[]>([]);
  const [isPending, startTransition] = useTransition();

  const fetchPage = useCallback(
    (m: DrilldownMetric, f: DrilldownFilters, p: number) => {
      startTransition(async () => {
        const result = await fetchDrilldownData({ metric: m, filters: f, page: p });
        if (result.success) {
          setData(result.data.data);
          setTotal(result.data.total);
          setPage(result.data.page);
        }
      });
    },
    [],
  );

  const open = useCallback(
    (m: DrilldownMetric, f: DrilldownFilters) => {
      const config = getDrilldownConfig(m, f);
      setMetric(m);
      setFilters(f);
      setTitle(config.title);
      setColumns(config.columns);
      setPage(1);
      setData([]);
      setTotal(0);
      setIsOpen(true);
      fetchPage(m, f, 1);
    },
    [fetchPage],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setMetric(null);
    setFilters(null);
    setData([]);
    setTotal(0);
    setPage(1);
  }, []);

  const goToPage = useCallback(
    (p: number) => {
      if (!metric || !filters) return;
      setPage(p);
      fetchPage(metric, filters, p);
    },
    [metric, filters, fetchPage],
  );

  return {
    isOpen,
    metric,
    filters,
    data,
    total,
    page,
    isLoading: isPending,
    title,
    columns,
    open,
    close,
    goToPage,
  };
}
