import { requireManager } from '@/lib/auth/require-manager';

import { fetchFeedbackAnalytics } from '@/features/statistics/actions/fetch-feedback-analytics';
import { FeedbackAnalyticsView } from '@/features/statistics/components/FeedbackAnalyticsView';
import { parseDateRangeParams } from '@/shared/utils/date-range';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string; closer?: string }>;
}

export default async function FeedbackAnalyticsPage({ searchParams }: PageProps) {
  await requireManager();
  const params = await searchParams;
  const { from, to } = parseDateRangeParams(params);
  const dateRange = { from, to };

  const result = await fetchFeedbackAnalytics('30d', params.closer, dateRange);

  if (!result.success) {
    return (
      <div className="p-6">
        <p className="text-[var(--destructive)]">Erro: {result.error}</p>
      </div>
    );
  }

  return (
    <FeedbackAnalyticsView
      data={result.data}
      filters={{ closer: params.closer, dateRange }}
    />
  );
}
