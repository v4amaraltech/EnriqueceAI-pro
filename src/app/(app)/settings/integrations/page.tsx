import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';

import { getOrgPlan } from '@/features/billing/actions/get-org-plan';
import type { PlanFeatures } from '@/features/billing/types';
import { fetchConnections } from '@/features/integrations/actions/fetch-connections';
import { IntegrationsView } from '@/features/integrations/components/IntegrationsView';

const DEFAULT_FEATURES: PlanFeatures = { enrichment: 'basic', crm: false, calendar: false };

export default async function IntegrationsPage() {
  const auth = await requireAuthWithMember();

  const [result, planResult] = await Promise.all([
    fetchConnections(),
    getOrgPlan(),
  ]);

  if (!result.success) {
    return <p className="py-10 text-center text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{result.error}</p>;
  }

  const planFeatures = planResult.success ? planResult.data.features : DEFAULT_FEATURES;

  return (
    <IntegrationsView
      gmail={result.data.gmail}
      whatsapp={result.data.whatsapp}
      crmConnections={result.data.crmConnections}
      calendar={result.data.calendar}
      api4com={result.data.api4com}
      evolutionInstance={result.data.evolutionInstance}
      apollo={result.data.apollo}
      planFeatures={planFeatures}
      isManager={auth.role === 'manager'}
    />
  );
}
