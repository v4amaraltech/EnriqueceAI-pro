import { requireManager } from '@/lib/auth/require-manager';

import { listCustomFields } from '@/features/settings-prospecting/actions/custom-fields-crud';
import { listStandardFieldSettings } from '@/features/settings-prospecting/actions/standard-field-settings';
import { CustomFieldsSettings } from '@/features/settings-prospecting/components/CustomFieldsSettings';

export default async function CustomFieldsPage() {
  await requireManager();

  const [customResult, standardResult] = await Promise.all([
    listCustomFields(),
    listStandardFieldSettings(),
  ]);

  if (!customResult.success) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{customResult.error}</p>
      </div>
    );
  }

  return (
    <CustomFieldsSettings
      initial={customResult.data}
      standardSettings={standardResult.success ? standardResult.data : []}
    />
  );
}
