import { requireAuth } from '@/lib/auth/require-auth';

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
  if (params.provider) filters.provider = params.provider;
  if (params.period) filters.period = params.period;
  if (params.user_id) filters.user_id = params.user_id;
  if (params.search) filters.search = params.search;
  if (params.important_only) filters.important_only = params.important_only;
  if (params.page) filters.page = params.page;

  return <CallsListView initialFilters={filters} />;
}
