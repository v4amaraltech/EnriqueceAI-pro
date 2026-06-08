import { requireManager } from '@/lib/auth/require-manager';

import { fetchLossReasonAnalytics } from '@/features/statistics/actions/fetch-loss-reason-analytics';
import { LossReasonAnalyticsView } from '@/features/statistics/components/LossReasonAnalyticsView';
import { currentMonthRange } from '@/shared/utils/date-range';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; user?: string; cadence?: string }>;
}

export default async function ProspectingLossReasonsPage({ searchParams }: PageProps) {
  await requireManager();
  const params = await searchParams;
  const userIds = params.user ? [params.user] : undefined;
  const cadenceId = params.cadence || undefined;

  const dateRange = params.from && params.to
    ? { from: params.from, to: params.to }
    : currentMonthRange();

  const result = await fetchLossReasonAnalytics('30d', userIds, cadenceId, dateRange);

  if (!result.success) {
    return <p className="text-[var(--destructive)]">Erro: {result.error}</p>;
  }

  return <LossReasonAnalyticsView data={result.data} />;
}
