import { format, subDays } from 'date-fns';

const DEFAULT_DAYS = 30;

export function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function defaultFrom(): string {
  return format(subDays(new Date(), DEFAULT_DAYS), 'yyyy-MM-dd');
}

export function periodToRange(period: string): { from: string; to: string } {
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

/** Server-safe helper: parse from/to from searchParams with backward compat */
export function parseDateRangeParams(params: {
  from?: string;
  to?: string;
  period?: string;
  compare?: string;
}): { from: string; to: string; compare: boolean } {
  const compare = params.compare === 'true';
  if (params.from && params.to) {
    return { from: params.from, to: params.to, compare };
  }
  if (params.period) {
    return { ...periodToRange(params.period), compare };
  }
  return { from: defaultFrom(), to: todayStr(), compare };
}
