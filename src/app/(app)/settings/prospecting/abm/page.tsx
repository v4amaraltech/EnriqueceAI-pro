import { requireManager } from '@/lib/auth/require-manager';

import { getOrgSettings } from '@/features/settings-prospecting/actions/org-settings-crud';
import { AbmSettings } from '@/features/settings-prospecting/components/AbmSettings';

export default async function AbmPage() {
  await requireManager();

  const result = await getOrgSettings();

  if (!result.success) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{result.error}</p>
      </div>
    );
  }

  return (
    <AbmSettings
      initialEnabled={result.data.abm_enabled}
      initialGroupField={result.data.abm_group_field}
    />
  );
}
