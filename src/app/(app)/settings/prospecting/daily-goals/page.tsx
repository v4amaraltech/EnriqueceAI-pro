import { requireManager } from '@/lib/auth/require-manager';

import { getDailyGoals } from '@/features/settings-prospecting/actions/get-daily-goals';
import { DailyGoalsSettings } from '@/features/settings-prospecting/components/DailyGoalsSettings';

export default async function DailyGoalsPage() {
  await requireManager();

  const result = await getDailyGoals();

  if (!result.success) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{result.error}</p>
      </div>
    );
  }

  return <DailyGoalsSettings initial={result.data} />;
}
