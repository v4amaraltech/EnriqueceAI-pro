import { BarChart3 } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';

import { EmptyState } from '@/shared/components/EmptyState';
import { parseDateRangeParams } from '@/shared/hooks/useDateRange';

import { fetchReportData } from '@/features/reports/actions/fetch-reports';
import { ReportsView } from '@/features/reports/components/ReportsView';

interface ReportsPageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string }>;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  await requireAuth();

  const params = await searchParams;
  const dateRange = parseDateRangeParams(params);

  const result = await fetchReportData('30d', dateRange);

  if (!result.success) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Relatórios"
        description={result.error}
      />
    );
  }

  return <ReportsView data={result.data} />;
}
