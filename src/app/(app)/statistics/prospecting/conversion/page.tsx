import { requireManager } from '@/lib/auth/require-manager';

import { fetchConversionAnalytics } from '@/features/statistics/actions/fetch-conversion-analytics';
import { fetchOrgMembers } from '@/features/statistics/actions/shared';
import { ConversionAnalyticsView } from '@/features/statistics/components/ConversionAnalyticsView';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; user?: string; cadence?: string }>;
}

export default async function ProspectingConversionPage({ searchParams }: PageProps) {
  await requireManager();
  const params = await searchParams;
  const userIds = params.user ? [params.user] : undefined;
  const cadenceId = params.cadence || undefined;

  const dateRange = params.from && params.to
    ? { from: params.from, to: params.to }
    : undefined;

  const [result, members] = await Promise.all([
    fetchConversionAnalytics('30d', userIds, cadenceId, dateRange),
    fetchOrgMembers(),
  ]);

  if (!result.success) {
    return <p className="text-[var(--destructive)]">Erro: {result.error}</p>;
  }

  return <ConversionAnalyticsView data={result.data} members={members} hideFilters />;
}
