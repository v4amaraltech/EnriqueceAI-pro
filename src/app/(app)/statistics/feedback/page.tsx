import { requireManager } from '@/lib/auth/require-manager';

import { fetchFeedbackAnalytics } from '@/features/statistics/actions/fetch-feedback-analytics';
import { FeedbackAnalyticsView } from '@/features/statistics/components/FeedbackAnalyticsView';
import { currentMonthRange, parseDateRangeParams } from '@/shared/utils/date-range';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string; closer?: string }>;
}

export default async function FeedbackAnalyticsPage({ searchParams }: PageProps) {
  await requireManager();
  const params = await searchParams;
  // Default to the current month (mês vigente) when the user hasn't picked a
  // range explicitly; honor explicit from/to or period from the URL otherwise.
  const hasExplicitRange = Boolean((params.from && params.to) || params.period);
  const { from, to } = hasExplicitRange ? parseDateRangeParams(params) : currentMonthRange();
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
