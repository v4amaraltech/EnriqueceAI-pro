'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, subDays } from 'date-fns';

const DEFAULT_DAYS = 30;

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function defaultFrom(): string {
  return format(subDays(new Date(), DEFAULT_DAYS), 'yyyy-MM-dd');
}

function periodToRange(period: string): { from: string; to: string } {
  const today = new Date();
  const to = format(today, 'yyyy-MM-dd');
  let days: number;
  switch (period) {
    case 'today':
      days = 0;
      break;
    case '7d':
      days = 7;
      break;
    case '90d':
      days = 90;
      break;
    case '30d':
    default:
      days = 30;
  }
  const from = days === 0 ? to : format(subDays(today, days), 'yyyy-MM-dd');
  return { from, to };
}

export function useDateRange(basePath?: string) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const legacyPeriod = searchParams.get('period');

  let from: string;
  let to: string;

  if (fromParam && toParam) {
    from = fromParam;
    to = toParam;
  } else if (legacyPeriod) {
    const range = periodToRange(legacyPeriod);
    from = range.from;
    to = range.to;
  } else {
    from = defaultFrom();
    to = todayStr();
  }

  const setRange = useCallback(
    (newFrom: string, newTo: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('period');
      params.set('from', newFrom);
      params.set('to', newTo);
      const path = basePath ?? window.location.pathname;
      router.push(`${path}?${params.toString()}`);
    },
    [router, searchParams, basePath],
  );

  return { from, to, setRange };
}

/** Server-side helper: parse from/to from searchParams with backward compat */
export function parseDateRangeParams(params: {
  from?: string;
  to?: string;
  period?: string;
}): { from: string; to: string } {
  if (params.from && params.to) {
    return { from: params.from, to: params.to };
  }
  if (params.period) {
    return periodToRange(params.period);
  }
  return { from: defaultFrom(), to: todayStr() };
}
