import { redirect } from 'next/navigation';

import { requireManager } from '@/lib/auth/require-manager';

export default async function CallSettingsPage() {
  await requireManager();
  redirect('/calls/ajustes/general');
}
