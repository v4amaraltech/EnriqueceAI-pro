import { requireAuth } from '@/lib/auth/require-auth';

import { fetchActivityAnalytics } from '@/features/statistics/actions/fetch-activity-analytics';
import { fetchOrgMembers } from '@/features/statistics/actions/shared';
import { ActivityAnalyticsView } from '@/features/statistics/components/ActivityAnalyticsView';
import { parseDateRangeParams } from '@/shared/hooks/useDateRange';
import { calculatePreviousPeriod } from '@/shared/utils/comparison';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string; user?: string; compare?: string }>;
}

export default async function ActivityAnalyticsPage({ searchParams }: PageProps) {
  await requireAuth();
  const params = await searchParams;
  const { from, to, compare } = parseDateRangeParams(params);
  const dateRange = { from, to };
  const userIds = params.user ? [params.user] : undefined;

  const [result, members, previousResult] = await Promise.all([
    fetchActivityAnalytics('30d', userIds, dateRange),
    fetchOrgMembers(),
    compare ? fetchActivityAnalytics('30d', userIds, calculatePreviousPeriod(from, to)) : Promise.resolve(null),
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
      <ActivityAnalyticsView data={result.data} members={members} previousData={previousData} />
    </div>
  );
}
