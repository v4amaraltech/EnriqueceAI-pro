'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  // Fetch Gmail connection (per user) — exclude encrypted tokens
  const { data: gmailRow } = (await from(supabase, 'gmail_connections')
    .select('id, email_address, custom_signature, status, created_at, updated_at')
    .eq('org_id', member.org_id)
    .eq('user_id', user.id)
    .maybeSingle()) as { data: GmailConnectionSafe | null };

  // Fetch WhatsApp connection (per org) — exclude encrypted tokens
  const { data: whatsappRow } = (await from(supabase, 'whatsapp_connections')
    .select('id, phone_number_id, business_account_id, status, created_at, updated_at')
    .eq('org_id', member.org_id)
    .maybeSingle()) as { data: WhatsAppConnectionSafe | null };

  // Fetch CRM connections (per org) — exclude encrypted credentials
  const { data: crmRows } = (await from(supabase, 'crm_connections')
    .select('id, crm_provider, field_mapping, status, last_sync_at, created_at, updated_at')
    .eq('org_id', member.org_id)) as { data: CrmConnectionSafe[] | null };

  // Fetch Calendar connection (per user) — exclude encrypted tokens
  const { data: calendarRow } = (await from(supabase, 'calendar_connections')
    .select('id, calendar_email, status, created_at, updated_at')
    .eq('org_id', member.org_id)
    .eq('user_id', user.id)
    .maybeSingle()) as { data: CalendarConnectionSafe | null };

  // Fetch API4Com connection (per user) — exclude encrypted api key
  const { data: api4comRaw } = (await from(supabase, 'api4com_connections' as never)
    .select('id, ramal, base_url, api_key_encrypted, status, created_at, updated_at')
    .eq('org_id', member.org_id)
    .eq('user_id', user.id)
    .maybeSingle()) as { data: { id: string; ramal: string; base_url: string; api_key_encrypted: string | null; status: string; created_at: string; updated_at: string } | null };

  // Fetch WhatsApp Evolution instance (per org)
  const { data: evolutionRow } = (await from(supabase, 'whatsapp_instances' as never)
    .select('id, instance_name, status, phone, created_at, updated_at')
    .eq('org_id', member.org_id)
    .maybeSingle()) as { data: WhatsAppEvolutionInstanceSafe | null };

  // Fetch Apollo connection (per org) — exclude encrypted api key
  const { data: apolloRow } = (await from(supabase, 'apollo_connections' as never)
    .select('id, status, created_at, updated_at')
    .eq('org_id', member.org_id)
    .maybeSingle()) as { data: ApolloConnectionSafe | null };

  const api4comRow: Api4ComConnectionSafe | null = api4comRaw
    ? {
        id: api4comRaw.id,
        ramal: api4comRaw.ramal,
        base_url: api4comRaw.base_url,
        has_api_key: !!api4comRaw.api_key_encrypted,
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
