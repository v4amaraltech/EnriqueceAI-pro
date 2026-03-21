import { requireManager } from '@/lib/auth/require-manager';

import { getFitScoreRules } from '@/features/settings-prospecting/actions/get-fit-score-rules';
import { FitScoreConfig } from '@/features/settings-prospecting/components/FitScoreConfig';

export default async function FitScorePage() {
  await requireManager();

  const result = await getFitScoreRules();

  if (!result.success) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{result.error}</p>
      </div>
    );
  }

  return <FitScoreConfig initial={result.data} />;
}
