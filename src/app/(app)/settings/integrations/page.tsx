import { requireAuth } from '@/lib/auth/require-auth';

import { fetchConnections } from '@/features/integrations/actions/fetch-connections';
import { IntegrationsView } from '@/features/integrations/components/IntegrationsView';

export default async function IntegrationsPage() {
  await requireAuth();

  const result = await fetchConnections();

  if (!result.success) {
    return <p className="py-10 text-center text-[var(--muted-foreground)]">{result.error}</p>;
  }

  return (
    <IntegrationsView
      gmail={result.data.gmail}
      whatsapp={result.data.whatsapp}
      crm={result.data.crm}
      calendar={result.data.calendar}
      api4com={result.data.api4com}
      evolutionInstance={result.data.evolutionInstance}
    />
  );
}
