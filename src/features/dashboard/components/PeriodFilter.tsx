'use client';

import { DateRangePicker } from '@/shared/components/DateRangePicker';
import { useDateRange } from '@/shared/hooks/useDateRange';

export function PeriodFilter() {
  const { from, to, setRange } = useDateRange('/dashboard');

  return <DateRangePicker from={from} to={to} onChange={setRange} />;
}
