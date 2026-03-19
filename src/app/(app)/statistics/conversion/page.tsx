import { requireAuth } from '@/lib/auth/require-auth';

import { fetchActiveCadenceOptions } from '@/features/statistics/actions/fetch-active-cadence-options';
import { fetchConversionAnalytics } from '@/features/statistics/actions/fetch-conversion-analytics';
import { fetchOrgMembers } from '@/features/statistics/actions/shared';
import { ConversionAnalyticsView } from '@/features/statistics/components/ConversionAnalyticsView';
import { parseDateRangeParams } from '@/shared/hooks/useDateRange';
import { calculatePreviousPeriod } from '@/shared/utils/comparison';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string; user?: string; sdr?: string; cadence?: string; compare?: string }>;
}

export default async function ConversionAnalyticsPage({ searchParams }: PageProps) {
  await requireAuth();
  const params = await searchParams;
  const { from, to, compare } = parseDateRangeParams(params);
  const dateRange = { from, to };
  const sdrParam = params.sdr ?? params.user;
  const userIds = sdrParam ? [sdrParam] : undefined;
  const cadenceId = params.cadence || undefined;

  const [result, members, cadences, previousResult] = await Promise.all([
    fetchConversionAnalytics('30d', userIds, cadenceId, dateRange),
    fetchOrgMembers(),
    fetchActiveCadenceOptions(),
    compare ? fetchConversionAnalytics('30d', userIds, cadenceId, calculatePreviousPeriod(from, to)) : Promise.resolve(null),
  ]);

  if (!result.success) {
    return (
      <div className="p-6">
        <p className="text-[var(--destructive)]">Erro: {result.error}</p>
      </div>
    );
  }

  const previousData = previousResult?.success ? previousResult.data : undefined;

  return (
    <div className="p-6">
      <ConversionAnalyticsView data={result.data} members={members} cadences={cadences} previousData={previousData} />
    </div>
  );
}
