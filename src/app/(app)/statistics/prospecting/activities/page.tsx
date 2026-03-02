import { requireManager } from '@/lib/auth/require-manager';

import { fetchActivityAnalytics } from '@/features/statistics/actions/fetch-activity-analytics';
import { fetchOrgMembers } from '@/features/statistics/actions/shared';
import { ActivityAnalyticsView } from '@/features/statistics/components/ActivityAnalyticsView';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; user?: string; cadence?: string }>;
}

export default async function ProspectingActivitiesPage({ searchParams }: PageProps) {
  await requireManager();
  const params = await searchParams;
  const userIds = params.user ? [params.user] : undefined;

  const dateRange = params.from && params.to
    ? { from: params.from, to: params.to }
    : undefined;

  const [result, members] = await Promise.all([
    fetchActivityAnalytics('30d', userIds, dateRange),
    fetchOrgMembers(),
  ]);

  if (!result.success) {
    return <p className="text-[var(--destructive)]">Erro: {result.error}</p>;
  }

  return <ActivityAnalyticsView data={result.data} members={members} hideFilters />;
}
