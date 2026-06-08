'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { currentMonthRange, periodToRange } from '@/shared/utils/date-range';

// Re-export for backward compatibility with client components
export { parseDateRangeParams } from '@/shared/utils/date-range';

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
    const range = currentMonthRange();
    from = range.from;
    to = range.to;
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

  const compare = searchParams.get('compare') === 'true';

  const setCompare = useCallback(
    (enabled: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      if (enabled) {
        params.set('compare', 'true');
      } else {
        params.delete('compare');
      }
      const path = basePath ?? window.location.pathname;
      router.push(`${path}?${params.toString()}`);
    },
    [router, searchParams, basePath],
  );

  return { from, to, setRange, compare, setCompare };
}
