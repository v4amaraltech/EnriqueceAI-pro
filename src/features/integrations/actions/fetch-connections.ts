'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { Api4ComConnectionSafe, CalendarConnectionSafe, CrmConnectionSafe, GmailConnectionSafe, ThreeCPlusConnectionSafe, WhatsAppConnectionSafe, WhatsAppEvolutionInstanceSafe } from '../types';

export interface ConnectionsOverview {
  gmail: GmailConnectionSafe | null;
  whatsapp: WhatsAppConnectionSafe | null;
  crm: CrmConnectionSafe | null;
  calendar: CalendarConnectionSafe | null;
  api4com: Api4ComConnectionSafe | null;
  threecplus: ThreeCPlusConnectionSafe | null;
  evolutionInstance: WhatsAppEvolutionInstanceSafe | null;
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
  const { data: gmailRow } = (await (supabase
    .from('gmail_connections') as ReturnType<typeof supabase.from>)
    .select('id, email_address, custom_signature, status, created_at, updated_at')
    .eq('org_id', member.org_id)
    .eq('user_id', user.id)
    .maybeSingle()) as { data: GmailConnectionSafe | null };

  // Fetch WhatsApp connection (per org) — exclude encrypted tokens
  const { data: whatsappRow } = (await (supabase
    .from('whatsapp_connections') as ReturnType<typeof supabase.from>)
    .select('id, phone_number_id, business_account_id, status, created_at, updated_at')
    .eq('org_id', member.org_id)
    .maybeSingle()) as { data: WhatsAppConnectionSafe | null };

  // Fetch CRM connection (per org) — exclude encrypted credentials
  const { data: crmRow } = (await (supabase
    .from('crm_connections') as ReturnType<typeof supabase.from>)
    .select('id, crm_provider, field_mapping, status, last_sync_at, created_at, updated_at')
    .eq('org_id', member.org_id)
    .limit(1)
    .maybeSingle()) as { data: CrmConnectionSafe | null };

  // Fetch Calendar connection (per user) — exclude encrypted tokens
  const { data: calendarRow } = (await (supabase
    .from('calendar_connections') as ReturnType<typeof supabase.from>)
    .select('id, calendar_email, status, created_at, updated_at')
    .eq('org_id', member.org_id)
    .eq('user_id', user.id)
    .maybeSingle()) as { data: CalendarConnectionSafe | null };

  // Fetch API4Com connection (per user) — exclude encrypted api key
  const { data: api4comRaw } = (await (supabase
    .from('api4com_connections' as never) as ReturnType<typeof supabase.from>)
    .select('id, ramal, base_url, api_key_encrypted, status, created_at, updated_at')
    .eq('org_id', member.org_id)
    .eq('user_id', user.id)
    .maybeSingle()) as { data: { id: string; ramal: string; base_url: string; api_key_encrypted: string | null; status: string; created_at: string; updated_at: string } | null };

  // Fetch 3CPlus connection (per user) — exclude encrypted token
  const { data: threecplusRaw } = (await (supabase
    .from('threecplus_connections' as never) as ReturnType<typeof supabase.from>)
    .select('id, extension, base_url, api_token_encrypted, status, created_at, updated_at')
    .eq('org_id', member.org_id)
    .eq('user_id', user.id)
    .maybeSingle()) as { data: { id: string; extension: string; base_url: string; api_token_encrypted: string | null; status: string; created_at: string; updated_at: string } | null };

  // Fetch WhatsApp Evolution instance (per org)
  const { data: evolutionRow } = (await (supabase
    .from('whatsapp_instances' as never) as ReturnType<typeof supabase.from>)
    .select('id, instance_name, status, phone, created_at, updated_at')
    .eq('org_id', member.org_id)
    .maybeSingle()) as { data: WhatsAppEvolutionInstanceSafe | null };

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

  const threecplusRow: ThreeCPlusConnectionSafe | null = threecplusRaw
    ? {
        id: threecplusRaw.id,
        extension: threecplusRaw.extension,
        base_url: threecplusRaw.base_url,
        has_api_token: !!threecplusRaw.api_token_encrypted,
        status: threecplusRaw.status as ThreeCPlusConnectionSafe['status'],
        created_at: threecplusRaw.created_at,
        updated_at: threecplusRaw.updated_at,
      }
    : null;

  return {
    success: true,
    data: {
      gmail: gmailRow ?? null,
      whatsapp: whatsappRow ?? null,
      crm: crmRow ?? null,
      calendar: calendarRow ?? null,
      api4com: api4comRow ?? null,
      threecplus: threecplusRow ?? null,
      evolutionInstance: evolutionRow ?? null,
    },
  };
}
