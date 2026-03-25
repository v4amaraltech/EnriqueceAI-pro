import { requireAuth } from '@/lib/auth/require-auth';

import { fetchCallDashboard } from '@/features/statistics/actions/fetch-call-dashboard';
import { fetchOrgMembers } from '@/features/statistics/actions/shared';
import { CallDashboardView } from '@/features/statistics/components/CallDashboardView';
import { parseDateRangeParams } from '@/shared/utils/date-range';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string; user?: string; sdr?: string }>;
}

export default async function CallDashboardPage({ searchParams }: PageProps) {
  await requireAuth();
  const params = await searchParams;
  const { from, to } = parseDateRangeParams(params);
  const dateRange = { from, to };
  const sdrParam = params.sdr ?? params.user;
  const userIds = sdrParam ? [sdrParam] : undefined;

  let result: Awaited<ReturnType<typeof fetchCallDashboard>>;
  let members: Awaited<ReturnType<typeof fetchOrgMembers>>;

  try {
    [result, members] = await Promise.all([
      fetchCallDashboard('30d', userIds, dateRange),
      fetchOrgMembers(),
    ]);
  } catch (error: unknown) {
    // Re-throw Next.js redirects
    if (
      error instanceof Error &&
      'digest' in error &&
      typeof (error as { digest: unknown }).digest === 'string' &&
      ((error as { digest: string }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    return (
      <div className="p-6">
        <p className="text-[var(--destructive)]">Erro ao carregar dados</p>
      </div>
    );
  }

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
