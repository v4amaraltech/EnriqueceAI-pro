import { Suspense } from 'react';

import { requireAuth } from '@/lib/auth/require-auth';

import { Skeleton } from '@/shared/components/ui/skeleton';

import { fetchUserMap } from '@/features/leads/actions/fetch-user-map';
import { fetchTemplates } from '@/features/templates/actions/fetch-templates';
import { TemplateListView } from '@/features/templates/components/TemplateListView';

interface TemplatesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TemplatesPage({ searchParams }: TemplatesPageProps) {
  await requireAuth();
  const params = await searchParams;

  const channel = typeof params.channel === 'string' ? params.channel : undefined;
  const search = typeof params.search === 'string' ? params.search : undefined;
  const is_system = typeof params.is_system === 'string' ? params.is_system === 'true' : undefined;
  const page = typeof params.page === 'string' ? parseInt(params.page, 10) : 1;

  const result = await fetchTemplates({ channel, search, is_system, page });

  if (!result.success) {
    return <p className="py-10 text-center text-[var(--muted-foreground)]">{result.error}</p>;
  }

  const uniqueUserIds = [
    ...new Set(
      result.data.data
        .map((t) => t.created_by)
        .filter((id): id is string => !!id),
    ),
  ];
  const userMapResult = await fetchUserMap(uniqueUserIds);
  const userMap = userMapResult.success ? userMapResult.data : {};

  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <TemplateListView
        templates={result.data.data}
        total={result.data.total}
        page={result.data.page}
        perPage={result.data.per_page}
        userMap={userMap}
      />
    </Suspense>
  );
}
