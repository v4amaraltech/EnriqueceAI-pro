import { requireAuth } from '@/lib/auth/require-auth';

import { fetchCallStatistics } from '@/features/statistics/actions/fetch-call-statistics';
import { fetchOrgMembers } from '@/features/statistics/actions/shared';
import { CallStatisticsView } from '@/features/statistics/components/CallStatisticsView';
import { parseDateRangeParams } from '@/shared/utils/date-range';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string; user?: string; sdr?: string }>;
}

export default async function CallStatisticsPage({ searchParams }: PageProps) {
  await requireAuth();
  const params = await searchParams;
  const { from, to } = parseDateRangeParams(params);
  const dateRange = { from, to };
  const sdrParam = params.sdr ?? params.user;
  const userIds = sdrParam ? [sdrParam] : undefined;

  const [result, members] = await Promise.all([
    fetchCallStatistics('30d', userIds, dateRange),
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
      <CallStatisticsView data={result.data} members={members} />
    </div>
  );
}
