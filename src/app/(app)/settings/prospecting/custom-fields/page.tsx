import { requireManager } from '@/lib/auth/require-manager';

import { listCustomFields } from '@/features/settings-prospecting/actions/custom-fields-crud';
import { CustomFieldsSettings } from '@/features/settings-prospecting/components/CustomFieldsSettings';

export default async function CustomFieldsPage() {
  await requireManager();

  const result = await listCustomFields();

  if (!result.success) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{result.error}</p>
      </div>
    );
  }

  return <CustomFieldsSettings initial={result.data} />;
}
