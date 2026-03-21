import { requireManager } from '@/lib/auth/require-manager';

import { listBlacklistDomains } from '@/features/settings-prospecting/actions/email-blacklist-crud';
import { BlacklistSettings } from '@/features/settings-prospecting/components/BlacklistSettings';

export default async function BlacklistPage() {
  await requireManager();

  const result = await listBlacklistDomains();

  if (!result.success) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{result.error}</p>
      </div>
    );
  }

  return <BlacklistSettings initial={result.data} />;
}
