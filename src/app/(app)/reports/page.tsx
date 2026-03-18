import { BarChart3 } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';

import { EmptyState } from '@/shared/components/EmptyState';
import { parseDateRangeParams } from '@/shared/hooks/useDateRange';
import { calculatePreviousPeriod } from '@/shared/utils/comparison';

import { fetchReportData } from '@/features/reports/actions/fetch-reports';
import { ReportsView } from '@/features/reports/components/ReportsView';

interface ReportsPageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string; compare?: string }>;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  await requireAuth();

  const params = await searchParams;
  const { from, to, compare } = parseDateRangeParams(params);
  const dateRange = { from, to };

  const fetches: [Promise<Awaited<ReturnType<typeof fetchReportData>>>, Promise<Awaited<ReturnType<typeof fetchReportData>>> | null] = [
    fetchReportData('30d', dateRange),
    compare ? fetchReportData('30d', calculatePreviousPeriod(from, to)) : null,
  ];

  const [result, previousResult] = await Promise.all(
    fetches.map((f) => f ?? Promise.resolve(null)),
  );

  if (!result?.success) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Relatórios"
        description={result?.success === false ? result.error : 'Erro ao carregar relatórios'}
      />
    );
  }

  const previousData = previousResult?.success ? previousResult.data : undefined;

  return <ReportsView data={result.data} previousData={previousData} />;
}
