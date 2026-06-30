import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { getOrgPlan } from '@/features/billing/actions/get-org-plan';
import type { PlanFeatures } from '@/features/billing/types';
import { fetchConnections } from '@/features/integrations/actions/fetch-connections';
import { IntegrationsView } from '@/features/integrations/components/IntegrationsView';
import type { MyWhatsAppNumber } from '@/features/whatsapp-calls/components/MyWhatsAppNumberCard';
import type { WhatsAppCallSessionStatus } from '@/features/whatsapp-calls/types';

const DEFAULT_FEATURES: PlanFeatures = { enrichment: 'basic', crm: false, calendar: false };

interface WhatsAppCallSessionRow {
  service_session_id: string | null;
  phone_number: string | null;
  status: WhatsAppCallSessionStatus;
}

export default async function IntegrationsPage() {
  const auth = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  const [result, planResult, sessionRes, userRes] = await Promise.all([
    fetchConnections(),
    getOrgPlan(),
    // Sessão de Ligação via WhatsApp do próprio usuário (auto-pareamento do SDR
    // na própria tela de Integrações — RLS permite o dono ler a sua).
    from(supabase, 'whatsapp_call_sessions')
      .select('service_session_id, phone_number, status')
      .eq('user_id', auth.userId)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);

  if (!result.success) {
    return <p className="py-10 text-center text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{result.error}</p>;
  }

  const planFeatures = planResult.success ? planResult.data.features : DEFAULT_FEATURES;

  const session = sessionRes.data as WhatsAppCallSessionRow | null;
  const user = userRes.data.user;
  const myWhatsAppCall: MyWhatsAppNumber = {
    userId: auth.userId,
    name: (user?.user_metadata?.full_name as string | undefined) || user?.email || 'Você',
    session: session
      ? {
          status: session.status,
          phoneNumber: session.phone_number,
          serviceSessionId: session.service_session_id,
        }
      : null,
  };

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
      myWhatsAppCall={myWhatsAppCall}
    />
  );
}
