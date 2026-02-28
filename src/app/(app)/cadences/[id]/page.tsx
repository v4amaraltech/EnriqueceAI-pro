import { notFound } from 'next/navigation';

import { requireAuth } from '@/lib/auth/require-auth';

import { fetchCadenceDetail } from '@/features/cadences/actions/fetch-cadences';
import { fetchCadenceEnrollments } from '@/features/cadences/actions/manage-enrollments';
import { fetchCadenceMetrics } from '@/features/cadences/actions/fetch-interactions';
import { fetchLossReasonsForCadence } from '@/features/cadences/actions/fetch-loss-reasons';
import { fetchTemplates } from '@/features/templates/actions/fetch-templates';
import { AutoEmailBuilder } from '@/features/cadences/components/AutoEmailBuilder';
import { CadenceBuilder } from '@/features/cadences/components/CadenceBuilder';

interface CadenceDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CadenceDetailPage({ params, searchParams }: CadenceDetailPageProps) {
  await requireAuth();
  const { id } = await params;
  const _sp = await searchParams;

  const [cadenceResult, templatesResult, metricsResult, enrollmentsResult, lossReasonsResult] = await Promise.all([
    fetchCadenceDetail(id),
    fetchTemplates({ per_page: 100 }),
    fetchCadenceMetrics(id),
    fetchCadenceEnrollments(id),
    fetchLossReasonsForCadence(),
  ]);

  if (!cadenceResult.success) {
    notFound();
  }

  const templates = templatesResult.success ? templatesResult.data.data : [];
  const metrics = metricsResult.success ? metricsResult.data : undefined;
  const enrollments = enrollmentsResult.success ? enrollmentsResult.data.data : [];
  const lossReasons = lossReasonsResult.success ? lossReasonsResult.data : [];

  // Route to appropriate builder based on cadence type
  if (cadenceResult.data.type === 'auto_email') {
    return <AutoEmailBuilder cadence={cadenceResult.data} metrics={metrics} lossReasons={lossReasons} />;
  }

  return (
    <CadenceBuilder
      cadence={cadenceResult.data}
      templates={templates}
      metrics={metrics}
      enrollments={enrollments}
      lossReasons={lossReasons}
    />
  );
}
