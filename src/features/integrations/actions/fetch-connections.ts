'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { Api4ComConnectionSafe, ApolloConnectionSafe, CalendarConnectionSafe, CrmConnectionSafe, GmailConnectionSafe, ThreeCPlusConnectionSafe, WhatsAppConnectionSafe, WhatsAppEvolutionInstanceSafe } from '../types';

export interface ConnectionsOverview {
  gmail: GmailConnectionSafe | null;
  whatsapp: WhatsAppConnectionSafe | null;
  crmConnections: CrmConnectionSafe[];
  calendar: CalendarConnectionSafe | null;
  api4com: Api4ComConnectionSafe | null;
  threecplus: ThreeCPlusConnectionSafe | null;
  evolutionInstance: WhatsAppEvolutionInstanceSafe | null;
  apollo: ApolloConnectionSafe | null;
}

export async function fetchConnections(): Promise<ActionResult<ConnectionsOverview>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Check user role — org-level connections are only visible to managers
  const { data: memberRow } = (await supabase
    .from('organization_members')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .single()) as { data: { role: string } | null };
  const isManager = memberRow?.role === 'manager';

  // Fetch Gmail connection (per user) — exclude encrypted tokens
  const { data: gmailRow } = (await from(supabase, 'gmail_connections')
    .select('id, email_address, custom_signature, status, created_at, updated_at')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()) as { data: GmailConnectionSafe | null };

  // Fetch WhatsApp connection (per org, manager-only)
  let whatsappRow: WhatsAppConnectionSafe | null = null;
  if (isManager) {
    const { data } = (await from(supabase, 'whatsapp_connections')
      .select('id, phone_number_id, business_account_id, status, created_at, updated_at')
      .eq('org_id', orgId)
      .maybeSingle()) as { data: WhatsAppConnectionSafe | null };
    whatsappRow = data;
  }

  // Fetch CRM connections (per org, manager-only)
  let crmRows: CrmConnectionSafe[] = [];
  if (isManager) {
    const { data } = (await from(supabase, 'crm_connections')
      .select('id, crm_provider, field_mapping, status, last_sync_at, created_at, updated_at')
      .eq('org_id', orgId)) as { data: CrmConnectionSafe[] | null };
    crmRows = data ?? [];
  }

  // Fetch Calendar connection (per user) — exclude encrypted tokens
  const { data: calendarRow } = (await from(supabase, 'calendar_connections')
    .select('id, calendar_email, status, created_at, updated_at')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()) as { data: CalendarConnectionSafe | null };

  // Fetch API4Com connection (per user) — exclude encrypted api key
  const { data: api4comRaw } = (await from(supabase, 'api4com_connections' as never)
    .select('id, ramal, base_url, api_key_encrypted, sip_domain, sip_password_encrypted, status, created_at, updated_at')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()) as { data: { id: string; ramal: string; base_url: string; api_key_encrypted: string | null; sip_domain: string | null; sip_password_encrypted: string | null; status: string; created_at: string; updated_at: string } | null };

  // Fetch WhatsApp Evolution instance (per org, all members — no sensitive data)
  const { data: evolutionRow } = (await from(supabase, 'whatsapp_instances' as never)
    .select('id, instance_name, status, phone, created_at, updated_at')
    .eq('org_id', orgId)
    .maybeSingle()) as { data: WhatsAppEvolutionInstanceSafe | null };

  // Fetch 3CPlus connection (per user) — exclude encrypted token
  const { data: threecplusRaw } = (await from(supabase, 'threecplus_connections' as never)
    .select('id, login, domain, api_token_encrypted, status, created_at, updated_at')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()) as { data: { id: string; login: string; domain: string; api_token_encrypted: string | null; status: string; created_at: string; updated_at: string } | null };

  // Fetch Apollo connection (per org, manager-only)
  let apolloRow: ApolloConnectionSafe | null = null;
  if (isManager) {
    const { data } = (await from(supabase, 'apollo_connections' as never)
      .select('id, status, created_at, updated_at')
      .eq('org_id', orgId)
      .maybeSingle()) as { data: ApolloConnectionSafe | null };
    apolloRow = data;
  }

  const api4comRow: Api4ComConnectionSafe | null = api4comRaw
    ? {
        id: api4comRaw.id,
        ramal: api4comRaw.ramal,
        base_url: api4comRaw.base_url,
        sip_domain: api4comRaw.sip_domain,
        has_api_key: !!api4comRaw.api_key_encrypted,
        has_sip_password: !!api4comRaw.sip_password_encrypted,
        status: api4comRaw.status as Api4ComConnectionSafe['status'],
        created_at: api4comRaw.created_at,
        updated_at: api4comRaw.updated_at,
      }
    : null;

  return {
    success: true,
    data: {
      gmail: gmailRow ?? null,
      whatsapp: whatsappRow ?? null,
      crmConnections: crmRows ?? [],
      calendar: calendarRow ?? null,
      api4com: api4comRow ?? null,
      threecplus: threecplusRaw
        ? {
            id: threecplusRaw.id,
            login: threecplusRaw.login,
            domain: threecplusRaw.domain,
            has_api_token: !!threecplusRaw.api_token_encrypted,
            status: threecplusRaw.status as ThreeCPlusConnectionSafe['status'],
            created_at: threecplusRaw.created_at,
            updated_at: threecplusRaw.updated_at,
          }
        : null,
      evolutionInstance: evolutionRow ?? null,
      apollo: apolloRow ?? null,
    },
  };
}
