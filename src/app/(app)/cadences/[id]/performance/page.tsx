import { notFound } from 'next/navigation';

import { requireAuth } from '@/lib/auth/require-auth';

import type { PerformancePeriod } from '@/features/cadences/cadences.contract';
import { fetchCadencePerformance } from '@/features/cadences/actions/fetch-cadence-performance';
import { CadencePerformanceView } from '@/features/cadences/components/CadencePerformanceView';

interface PerformancePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const validPeriods = new Set<PerformancePeriod>(['7d', '30d', '90d', 'all']);

export default async function CadencePerformancePage({ params, searchParams }: PerformancePageProps) {
  await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  const rawPeriod = typeof sp.period === 'string' ? sp.period : 'all';
  const period: PerformancePeriod = validPeriods.has(rawPeriod as PerformancePeriod)
    ? (rawPeriod as PerformancePeriod)
    : 'all';

  const result = await fetchCadencePerformance(id, period);

  if (!result.success) {
    notFound();
  }

  return <CadencePerformanceView data={result.data} period={period} />;
}
