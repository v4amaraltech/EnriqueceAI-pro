import { requireAuth } from '@/lib/auth/require-auth';

import { fetchOrgMembers } from '@/features/statistics/actions/shared';
import { fetchTeamAnalytics } from '@/features/statistics/actions/fetch-team-analytics';
import { TeamAnalyticsView } from '@/features/statistics/components/TeamAnalyticsView';
import { parseDateRangeParams } from '@/shared/utils/date-range';
import { calculatePreviousPeriod } from '@/shared/utils/comparison';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string; sdr?: string; compare?: string }>;
}

export default async function TeamAnalyticsPage({ searchParams }: PageProps) {
  await requireAuth();
  const params = await searchParams;
  const { from, to, compare } = parseDateRangeParams(params);
  const dateRange = { from, to };

  const [result, members, previousResult] = await Promise.all([
    fetchTeamAnalytics('30d', dateRange),
    fetchOrgMembers(),
    compare ? fetchTeamAnalytics('30d', calculatePreviousPeriod(from, to)) : Promise.resolve(null),
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
      <TeamAnalyticsView data={result.data} members={members} previousData={previousData} />
    </div>
  );
}
