import { requireManager } from '@/lib/auth/require-manager';

import { getOrgSettings } from '@/features/settings-prospecting/actions/org-settings-crud';
import { LeadAccessSettings } from '@/features/settings-prospecting/components/LeadAccessSettings';

export default async function AccessPage() {
  await requireManager();

  const result = await getOrgSettings();

  if (!result.success) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{result.error}</p>
      </div>
    );
  }

  return <LeadAccessSettings initialMode={result.data.lead_visibility_mode} />;
}
