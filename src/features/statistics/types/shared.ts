import { z } from 'zod';

export type StatisticsPeriod = 'today' | '7d' | '30d' | '90d';

export interface PeriodOption {
  value: StatisticsPeriod;
  label: string;
}

export const periodOptions: PeriodOption[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
];

export const analyticsParamsSchema = z.object({
  period: z.enum(['today', '7d', '30d', '90d']).default('30d'),
  userIds: z.array(z.string().uuid()).max(100).optional(),
  cadenceId: z.string().uuid().optional(),
  dateRange: z.object({
    from: z.string().min(10),
    to: z.string().min(10),
  }).optional(),
});

export interface OrgMember {
  userId: string;
  email: string;
  name?: string;
}

export function getPeriodDates(period: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();
  let start: Date;

  switch (period) {
    case 'today': {
      const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const todayStr = nowBrt.toISOString().split('T')[0];
      start = new Date(`${todayStr}T03:00:00Z`);
      break;
    }
    case '7d':
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
    default:
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
  }

  return { start: start.toISOString(), end };
}

// Re-export shared formatters from canonical location
export { safeRate, formatDuration, formatDurationLong } from '@/lib/utils/format';

/** Group items by a key function — O(n) lookup map builder. */
export function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = map.get(key);
    if (arr) {
      arr.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}
