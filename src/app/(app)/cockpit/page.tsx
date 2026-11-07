import { requireAuth } from '@/lib/auth/require-auth';

import { fetchCockpit } from '@/features/whatsapp-auto-send/actions/fetch-cockpit';
import { CockpitView } from '@/features/whatsapp-auto-send/components/CockpitView';

export const dynamic = 'force-dynamic';

export default async function CockpitPage() {
  await requireAuth();
  const result = await fetchCockpit();

  if (!result.success) {
    return <p className="text-destructive text-sm">{result.error}</p>;
  }

  return <CockpitView data={result.data} />;
}
