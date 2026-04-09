import { requireAuth } from '@/lib/auth/require-auth';

import { ImportView } from '@/features/leads/components/ImportView';

export default async function ImportLeadsPage() {
  await requireAuth();

  return <ImportView />;
}
