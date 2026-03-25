import { requireAuth } from '@/lib/auth/require-auth';

import { fetchExtrato } from '@/features/calls/actions/fetch-extrato';
import { ExtratoView } from '@/features/calls/components/ExtratoView';
import { fetchOrgMembers } from '@/features/statistics/actions/shared';
import { parseDateRangeParams } from '@/shared/hooks/useDateRange';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string; user?: string; sdr?: string }>;
}

export default async function ExtratoPage({ searchParams }: PageProps) {
  await requireAuth();
  const params = await searchParams;
  const { from, to } = parseDateRangeParams(params);
  const dateRange = { from, to };
  const sdrParam = params.sdr ?? params.user;
  const userIds = sdrParam ? [sdrParam] : undefined;

  let result: Awaited<ReturnType<typeof fetchExtrato>>;
  let members: Awaited<ReturnType<typeof fetchOrgMembers>>;

  try {
    [result, members] = await Promise.all([
      fetchExtrato('30d', userIds, dateRange),
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
      <ExtratoView
        data={result.data}
        members={members}
        userId={sdrParam}
      />
    </div>
  );
}
