import { requireAuth } from '@/lib/auth/require-auth';

import { fetchConversionAnalytics } from '@/features/statistics/actions/fetch-conversion-analytics';
import { fetchOrgMembers } from '@/features/statistics/actions/shared';
import { ConversionAnalyticsView } from '@/features/statistics/components/ConversionAnalyticsView';
import { parseDateRangeParams } from '@/shared/hooks/useDateRange';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string; user?: string; cadence?: string }>;
}

export default async function ConversionAnalyticsPage({ searchParams }: PageProps) {
  await requireAuth();
  const params = await searchParams;
  const { from, to } = parseDateRangeParams(params);
  const dateRange = { from, to };
  const userIds = params.user ? [params.user] : undefined;
  const cadenceId = params.cadence || undefined;

  const [result, members] = await Promise.all([
    fetchConversionAnalytics('30d', userIds, cadenceId, dateRange),
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
      <ConversionAnalyticsView data={result.data} members={members} />
    </div>
  );
}
