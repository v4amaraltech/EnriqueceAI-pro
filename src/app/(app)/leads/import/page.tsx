import { requireAuth } from '@/lib/auth/require-auth';

import { getLeadSourceOptions } from '@/features/leads/actions/get-lead-source-options';
import { ImportView } from '@/features/leads/components/ImportView';

export default async function ImportLeadsPage() {
  await requireAuth();

  const leadSourceOptions = await getLeadSourceOptions();

  return <ImportView leadSourceOptions={leadSourceOptions} />;
}
