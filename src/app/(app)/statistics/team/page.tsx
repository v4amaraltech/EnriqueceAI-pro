import { requireAuth } from '@/lib/auth/require-auth';

import { fetchOrgMembers } from '@/features/statistics/actions/shared';
import { fetchTeamAnalytics } from '@/features/statistics/actions/fetch-team-analytics';
import { TeamAnalyticsView } from '@/features/statistics/components/TeamAnalyticsView';
import { parseDateRangeParams } from '@/shared/hooks/useDateRange';
import { calculatePreviousPeriod } from '@/shared/utils/comparison';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string; sdr?: string; compare?: string }>;
}

export default async function TeamAnalyticsPage({ searchParams }: PageProps) {
  try {
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
  } catch (error) {
    if (error instanceof Error && 'digest' in error && typeof (error as { digest: unknown }).digest === 'string' && ((error as { digest: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    console.error('[TeamAnalyticsPage] PAGE_CRASH:', error);
    console.error('[TeamAnalyticsPage] PAGE_CRASH_STACK:', error instanceof Error ? error.stack : 'no stack');
    throw error;
  }
}
