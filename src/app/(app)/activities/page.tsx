import { AlertTriangle } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';
import { EmptyState } from '@/shared/components/EmptyState';

import { fetchActivityTemplates } from '@/features/activity-templates/actions/fetch-activity-templates';
import { ActivityTemplatesPage } from '@/features/activity-templates/components/ActivityTemplatesPage';

export default async function ActivitiesPage() {
  await requireAuth();

  const result = await fetchActivityTemplates();

  if (!result.success) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Erro ao carregar templates"
        description={result.error}
      />
    );
  }

  return <ActivityTemplatesPage initialTemplates={result.data} />;
}
