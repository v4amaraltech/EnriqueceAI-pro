import { requireAuth } from '@/lib/auth/require-auth';

import { fetchImports } from '@/features/leads/actions/fetch-imports';
import { getLeadSourceOptions } from '@/features/leads/actions/get-lead-source-options';
import { ImportListView } from '@/features/leads/components/ImportListView';

export default async function ImportHistoryPage() {
  await requireAuth();

  const [result, leadSourceOptions] = await Promise.all([
    fetchImports(),
    getLeadSourceOptions(),
  ]);

  if (!result.success) {
    return (
      <div className="py-12 text-center text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Erro ao carregar importações: {result.error}
      </div>
    );
  }

  return <ImportListView result={result.data} leadSourceOptions={leadSourceOptions} />;
}
