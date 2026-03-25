import { BarChart3 } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';

import { EmptyState } from '@/shared/components/EmptyState';
import { parseDateRangeParams } from '@/shared/utils/date-range';
import { calculatePreviousPeriod } from '@/shared/utils/comparison';

import { fetchReportData } from '@/features/reports/actions/fetch-reports';
import { ReportsView } from '@/features/reports/components/ReportsView';
import { fetchActiveCadenceOptions } from '@/features/statistics/actions/fetch-active-cadence-options';
import { fetchOrgMembers } from '@/features/statistics/actions/shared';

interface ReportsPageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string; compare?: string; sdr?: string; cadence?: string }>;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  await requireAuth();

  const params = await searchParams;
  const { from, to, compare } = parseDateRangeParams(params);
  const dateRange = { from, to };
  const sdrId = params.sdr || undefined;
  const cadenceId = params.cadence || undefined;

  const [result, previousResult, members, cadences] = await Promise.all([
    fetchReportData('30d', dateRange, sdrId, cadenceId),
    compare
      ? fetchReportData('30d', calculatePreviousPeriod(from, to), sdrId, cadenceId)
      : Promise.resolve(null),
    fetchOrgMembers(),
    fetchActiveCadenceOptions(),
  ]);

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

  return (
    <ReportsView
      data={result.data}
      previousData={previousData}
      members={members}
      cadences={cadences}
    />
  );
}
