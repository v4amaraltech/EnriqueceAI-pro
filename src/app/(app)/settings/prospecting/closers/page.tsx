import { requireManager } from '@/lib/auth/require-manager';

import { listClosers } from '@/features/settings-prospecting/actions/closers-crud';
import { ClosersSettings } from '@/features/settings-prospecting/components/ClosersSettings';

export default async function ClosersPage() {
  await requireManager();

  const result = await listClosers();

  if (!result.success) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{result.error}</p>
      </div>
    );
  }

  return <ClosersSettings initial={result.data} />;
}
