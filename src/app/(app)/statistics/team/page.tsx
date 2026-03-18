import { requireAuth } from '@/lib/auth/require-auth';

import { fetchOrgMembers } from '@/features/statistics/actions/shared';
import { fetchTeamAnalytics } from '@/features/statistics/actions/fetch-team-analytics';
import { TeamAnalyticsView } from '@/features/statistics/components/TeamAnalyticsView';
import { parseDateRangeParams } from '@/shared/hooks/useDateRange';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string }>;
}

export default async function TeamAnalyticsPage({ searchParams }: PageProps) {
  await requireAuth();
  const params = await searchParams;
  const { from, to } = parseDateRangeParams(params);
  const dateRange = { from, to };

  const [result, members] = await Promise.all([
    fetchTeamAnalytics('30d', dateRange),
    fetchOrgMembers(),
  ]);

  if (!result.success) {
    return (
      <div className="p-6">
        <p className="text-[var(--destructive)]">Erro: {result.error}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <TeamAnalyticsView data={result.data} members={members} />
    </div>
  );
}
