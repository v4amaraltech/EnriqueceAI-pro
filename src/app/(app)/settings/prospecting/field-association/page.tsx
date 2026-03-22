import { requireManager } from '@/lib/auth/require-manager';

import { fetchCrmConnections } from '@/features/integrations/actions/manage-crm';
import { FieldAssociationSettings } from '@/features/settings-prospecting/components/FieldAssociationSettings';

export default async function FieldAssociationPage() {
  await requireManager();

  const result = await fetchCrmConnections();

  if (!result.success) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{result.error}</p>
      </div>
    );
  }

  return <FieldAssociationSettings connections={result.data} />;
}
