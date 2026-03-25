import { requireManager } from '@/lib/auth/require-manager';

import { getCallSettings } from '@/features/calls/actions/call-settings-crud';
import { CallGeneralSettings } from '@/features/calls/components/CallGeneralSettings';

export default async function CallGeneralSettingsPage() {
  await requireManager();

  const settingsResult = await getCallSettings();

  if (!settingsResult.success) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted-foreground)]">{settingsResult.error}</p>
      </div>
    );
  }

  return <CallGeneralSettings initial={settingsResult.data.settings} />;
}
