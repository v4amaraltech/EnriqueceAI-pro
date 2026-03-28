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
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
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
