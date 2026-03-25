import { requireManager } from '@/lib/auth/require-manager';

import { getCallSettings } from '@/features/calls/actions/call-settings-crud';
import { PhoneBlacklistSettings } from '@/features/calls/components/PhoneBlacklistSettings';

export default async function PhoneBlacklistPage() {
  await requireManager();

  const settingsResult = await getCallSettings();

  if (!settingsResult.success) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted-foreground)]">{settingsResult.error}</p>
      </div>
    );
  }

  return <PhoneBlacklistSettings initial={settingsResult.data.blacklist} />;
}
