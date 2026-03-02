import { requireManager } from '@/lib/auth/require-manager';

import { fetchEmailAnalytics } from '@/features/statistics/actions/fetch-email-analytics';
import { EmailAnalyticsView } from '@/features/statistics/components/EmailAnalyticsView';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; user?: string; cadence?: string }>;
}

export default async function ProspectingEmailsPage({ searchParams }: PageProps) {
  await requireManager();
  const params = await searchParams;
  const userIds = params.user ? [params.user] : undefined;
  const cadenceId = params.cadence || undefined;

  const dateRange = params.from && params.to
    ? { from: params.from, to: params.to }
    : undefined;

  const result = await fetchEmailAnalytics('30d', userIds, cadenceId, dateRange);

  if (!result.success) {
    return <p className="text-[var(--destructive)]">Erro: {result.error}</p>;
  }

  return <EmailAnalyticsView data={result.data} />;
}
