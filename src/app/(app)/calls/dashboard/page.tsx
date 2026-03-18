import { requireAuth } from '@/lib/auth/require-auth';

import { fetchCallDashboard } from '@/features/statistics/actions/fetch-call-dashboard';
import { fetchOrgMembers } from '@/features/statistics/actions/shared';
import { CallDashboardView } from '@/features/statistics/components/CallDashboardView';
import { parseDateRangeParams } from '@/shared/hooks/useDateRange';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string; user?: string }>;
}

export default async function CallDashboardPage({ searchParams }: PageProps) {
  await requireAuth();
  const params = await searchParams;
  const { from, to } = parseDateRangeParams(params);
  const dateRange = { from, to };
  const userIds = params.user ? [params.user] : undefined;

  const [result, members] = await Promise.all([
    fetchCallDashboard('30d', userIds, dateRange),
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
      <CallDashboardView data={result.data} members={members} />
    </div>
  );
}
