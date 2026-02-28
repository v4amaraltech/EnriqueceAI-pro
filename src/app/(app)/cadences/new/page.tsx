import { requireAuth } from '@/lib/auth/require-auth';

import { fetchTemplates } from '@/features/templates/actions/fetch-templates';
import { fetchLossReasonsForCadence } from '@/features/cadences/actions/fetch-loss-reasons';
import { AutoEmailBuilder } from '@/features/cadences/components/AutoEmailBuilder';
import { CadenceBuilder } from '@/features/cadences/components/CadenceBuilder';

interface NewCadencePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewCadencePage({ searchParams }: NewCadencePageProps) {
  await requireAuth();
  const sp = await searchParams;
  const type = sp.type as string | undefined;

  const lossReasonsResult = await fetchLossReasonsForCadence();
  const lossReasons = lossReasonsResult.success ? lossReasonsResult.data : [];

  if (type === 'auto_email') {
    return <AutoEmailBuilder lossReasons={lossReasons} />;
  }

  const result = await fetchTemplates({ per_page: 100 });
  const templates = result.success ? result.data.data : [];

  return <CadenceBuilder templates={templates} lossReasons={lossReasons} />;
}
