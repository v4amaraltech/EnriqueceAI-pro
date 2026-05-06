'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { Api4ComConnectionSafe, ApolloConnectionSafe, CalendarConnectionSafe, CrmConnectionSafe, GmailConnectionSafe, WhatsAppConnectionSafe, WhatsAppEvolutionInstanceSafe } from '../types';

export interface ConnectionsOverview {
  gmail: GmailConnectionSafe | null;
  whatsapp: WhatsAppConnectionSafe | null;
  crmConnections: CrmConnectionSafe[];
  calendar: CalendarConnectionSafe | null;
  api4com: Api4ComConnectionSafe | null;
  evolutionInstance: WhatsAppEvolutionInstanceSafe | null;
  apollo: ApolloConnectionSafe | null;
}

export async function fetchConnections(): Promise<ActionResult<ConnectionsOverview>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Check user role — org-level connections are only visible to managers
  const { data: memberRow } = (await from(supabase, 'organization_members')
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

  // Fetch WhatsApp Evolution instance for current user (fallback to org default)
  let evolutionRow: WhatsAppEvolutionInstanceSafe | null = null;
  const { data: userEvolution } = (await from(supabase, 'whatsapp_instances' as never)
    .select('id, instance_name, status, phone, created_at, updated_at')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()) as { data: WhatsAppEvolutionInstanceSafe | null };
  if (userEvolution) {
    evolutionRow = userEvolution;
  } else {
    const { data: orgEvolution } = (await from(supabase, 'whatsapp_instances' as never)
      .select('id, instance_name, status, phone, created_at, updated_at')
      .eq('org_id', orgId)
      .is('user_id', null)
      .maybeSingle()) as { data: WhatsAppEvolutionInstanceSafe | null };
    evolutionRow = orgEvolution;
  }

  // Fetch Apollo connection (per org). RLS allows any active member to read, so SDRs
  // see the org-level status without sensitive fields (api_key_encrypted is never selected).
  const { data: apolloRow } = (await from(supabase, 'apollo_connections' as never)
    .select('id, status, created_at, updated_at')
    .eq('org_id', orgId)
    .maybeSingle()) as { data: ApolloConnectionSafe | null };

  // sip_domain is the same for every SDR in the org. Fetch the manager's value
  // so the modal can suggest it when the SDR's own row hasn't been filled yet.
  let orgSipDomain: string | null = api4comRaw?.sip_domain ?? null;
  if (!orgSipDomain) {
    const { data: domainFallback } = (await from(supabase, 'api4com_connections' as never)
      .select('sip_domain')
      .eq('org_id', orgId)
      .not('sip_domain', 'is', null)
      .limit(1)
      .maybeSingle()) as { data: { sip_domain: string | null } | null };
    orgSipDomain = domainFallback?.sip_domain ?? null;
  }

  const api4comRow: Api4ComConnectionSafe | null = api4comRaw
    ? {
        id: api4comRaw.id,
        ramal: api4comRaw.ramal,
        base_url: api4comRaw.base_url,
        sip_domain: api4comRaw.sip_domain,
        org_sip_domain: orgSipDomain,
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
      evolutionInstance: evolutionRow ?? null,
      apollo: apolloRow ?? null,
    },
  };
}
