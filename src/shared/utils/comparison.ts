import { differenceInDays, format, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export type DeltaDirection = 'up' | 'down' | 'neutral';

export interface DeltaValue {
  percentage: number | null;
  absolute: number;
  previousValue: number;
  direction: DeltaDirection;
}

/**
 * Calculates the previous period as a mirror of the given range.
 * E.g. Mar 1–15 (15 days) → Feb 14–28.
 */
export function calculatePreviousPeriod(
  from: string,
  to: string,
): { from: string; to: string } {
  const fromDate = new Date(from + 'T00:00:00');
  const toDate = new Date(to + 'T00:00:00');
  const days = differenceInDays(toDate, fromDate) + 1;

  const prevTo = subDays(fromDate, 1);
  const prevFrom = subDays(prevTo, days - 1);

  return {
    from: format(prevFrom, 'yyyy-MM-dd'),
    to: format(prevTo, 'yyyy-MM-dd'),
  };
}

/**
 * Calculates the delta between current and previous values.
 * Returns null percentage when previous is 0 (infinite growth).
 */
export function calculateDelta(
  current: number,
  previous: number,
): DeltaValue {
  const absolute = current - previous;

  let direction: DeltaDirection;
  if (absolute > 0) direction = 'up';
  else if (absolute < 0) direction = 'down';
  else direction = 'neutral';

  const percentage =
    previous === 0 ? null : Math.round((absolute / previous) * 1000) / 10;

  return { percentage, absolute, previousValue: previous, direction };
}

/**
 * Formats a date range as a human-readable label in pt-BR.
 * E.g. "01 mar — 15 mar" or "01 fev — 28 fev"
 */
export function formatPeriodLabel(from: string, to: string): string {
  const fromDate = new Date(from + 'T00:00:00');
  const toDate = new Date(to + 'T00:00:00');

  const fromStr = format(fromDate, 'dd MMM', { locale: ptBR });
  const toStr = format(toDate, 'dd MMM', { locale: ptBR });

  return `${fromStr} — ${toStr}`;
}
