import { permanentRedirect } from 'next/navigation';

import { requireManager } from '@/lib/auth/require-manager';

export default async function ProspectingSettingsPage() {
  await requireManager();
  permanentRedirect('/settings/prospecting/daily-goals');
}
