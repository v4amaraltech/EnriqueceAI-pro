import { requireManager } from '@/lib/auth/require-manager';

import { listLossReasons } from '@/features/settings-prospecting/actions/loss-reasons-crud';
import { LossReasonsSettings } from '@/features/settings-prospecting/components/LossReasonsSettings';

export default async function LossReasonsPage() {
  await requireManager();

  const result = await listLossReasons();

  if (!result.success) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{result.error}</p>
      </div>
    );
  }

  return <LossReasonsSettings initial={result.data} />;
}
