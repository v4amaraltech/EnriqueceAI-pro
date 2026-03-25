import { AlertTriangle } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';

import { EmptyState } from '@/shared/components/EmptyState';

import { getCalls } from '@/features/calls/actions/get-calls';
import { CallsListView } from '@/features/calls/components/CallsListView';

interface CallsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CallsPage({ searchParams }: CallsPageProps) {
  await requireAuth();

  const params = await searchParams;

  // Build filters from URL search params
  const filters: Record<string, unknown> = {};
  if (params.status) filters.status = params.status;
  if (params.period) filters.period = params.period;
  if (params.user_id) filters.user_id = params.user_id;
  if (params.search) filters.search = params.search;
  if (params.important_only) filters.important_only = params.important_only;
  if (params.page) filters.page = params.page;

  const hasFilters = !!(params.status || params.period || params.search || params.important_only === 'true');

  const result = await getCalls(filters);

  if (!result.success) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Erro ao carregar ligações"
        description={result.error}
      />
    );
  }

  return <CallsListView result={result.data} hasFilters={hasFilters} currentFilters={filters} />;
}
