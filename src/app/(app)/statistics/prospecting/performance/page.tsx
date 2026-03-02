import { requireManager } from '@/lib/auth/require-manager';

import { fetchPerformanceAnalytics } from '@/features/statistics/actions/fetch-performance-analytics';
import { PerformanceAnalyticsView } from '@/features/statistics/components/PerformanceAnalyticsView';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; user?: string; cadence?: string }>;
}

export default async function ProspectingPerformancePage({ searchParams }: PageProps) {
  await requireManager();
  const params = await searchParams;
  const userIds = params.user ? [params.user] : undefined;
  const cadenceId = params.cadence || undefined;

  const dateRange = params.from && params.to
    ? { from: params.from, to: params.to }
    : undefined;

  const result = await fetchPerformanceAnalytics('30d', userIds, cadenceId, dateRange);

  if (!result.success) {
    return <p className="text-[var(--destructive)]">Erro: {result.error}</p>;
  }

  return <PerformanceAnalyticsView data={result.data} />;
}
