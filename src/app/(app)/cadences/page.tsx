import { Suspense } from 'react';
import { AlertTriangle } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';

import { EmptyState } from '@/shared/components/EmptyState';
import { Skeleton } from '@/shared/components/ui/skeleton';

import { fetchCadenceEnrollmentCounts, fetchCadences, fetchCadenceTabCounts } from '@/features/cadences/actions/fetch-cadences';
import { fetchAutoEmailMetrics } from '@/features/cadences/actions/fetch-auto-email-metrics';
import { CadenceListView } from '@/features/cadences/components/CadenceListView';
import { fetchOrgMembersAuth } from '@/features/leads/actions/fetch-org-members';
import { fetchAvatarMap, fetchUserMap } from '@/features/leads/actions/fetch-user-map';

interface CadencesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CadencesPage({ searchParams }: CadencesPageProps) {
  await requireAuth();
  const params = await searchParams;

  const status = typeof params.status === 'string' ? params.status : undefined;
  const search = typeof params.search === 'string' ? params.search : undefined;
  const type = typeof params.type === 'string' ? params.type : undefined;
  const priority = typeof params.priority === 'string' ? params.priority : undefined;
  const origin = typeof params.origin === 'string' ? params.origin : undefined;
  const created_by = typeof params.created_by === 'string' ? params.created_by : undefined;
  const sort_by = typeof params.sort_by === 'string' ? params.sort_by : undefined;
  const sort_dir = typeof params.sort_dir === 'string' ? params.sort_dir : undefined;
  const page = typeof params.page === 'string' ? parseInt(params.page, 10) : 1;

  const activeType = type || 'standard';

  const [result, countsResult, membersResult] = await Promise.all([
    fetchCadences({ status, search, type: activeType, priority, origin, created_by, sort_by, sort_dir, page }),
    fetchCadenceTabCounts(),
    fetchOrgMembersAuth(),
  ]);

  if (!result.success) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Erro ao carregar cadências"
        description={result.error}
      />
    );
  }

  const tabCounts = countsResult.success
    ? countsResult.data
    : { standard: 0, auto_email: 0 };

  // Fetch metrics for auto_email tab
  let metrics: Record<string, import('@/features/cadences/cadences.contract').AutoEmailCadenceMetrics> | undefined;
  if (activeType === 'auto_email' && result.data.data.length > 0) {
    const cadenceIds = result.data.data.map((c) => c.id);
    const metricsResult = await fetchAutoEmailMetrics(cadenceIds);
    if (metricsResult.success) {
      metrics = metricsResult.data;
    }
  }

  // Fetch enrollment counts + resolve creator names
  const cadenceIds = result.data.data.map((c) => c.id);
  const creatorIds = [...new Set(result.data.data.map((c) => c.created_by).filter(Boolean))] as string[];
  const [userMapResult, avatarMapResult, enrollmentResult] = await Promise.all([
    fetchUserMap(creatorIds),
    fetchAvatarMap(creatorIds),
    fetchCadenceEnrollmentCounts(cadenceIds),
  ]);
  const userMap = userMapResult.success ? userMapResult.data : {};
  const avatarMap = avatarMapResult.success ? avatarMapResult.data : {};
  const enrollmentCounts = enrollmentResult.success ? enrollmentResult.data : {};
  const members = membersResult.success ? membersResult.data : [];

  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <CadenceListView
        cadences={result.data.data}
        total={result.data.total}
        page={result.data.page}
        perPage={result.data.per_page}
        tabCounts={tabCounts}
        metrics={metrics}
        userMap={userMap}
        avatarMap={avatarMap}
        members={members}
        enrollmentCounts={enrollmentCounts}
      />
    </Suspense>
  );
}
