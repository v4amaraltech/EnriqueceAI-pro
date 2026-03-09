'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { encrypt } from '@/lib/security/encryption';

import type { WhatsAppConnectionSafe } from '../types';

interface WhatsAppConfig {
  phone_number_id: string;
  business_account_id: string;
  access_token: string;
}

export async function connectWhatsApp(
  config: WhatsAppConfig,
): Promise<ActionResult<WhatsAppConnectionSafe>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string; role: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  if (member.role !== 'owner' && member.role !== 'admin') {
    return { success: false, error: 'Apenas administradores podem configurar WhatsApp' };
  }

  if (!config.phone_number_id || !config.business_account_id || !config.access_token) {
    return { success: false, error: 'Todos os campos são obrigatórios' };
  }

  // Upsert connection (1 per org)
  const { data, error } = (await from(supabase, 'whatsapp_connections')
    .upsert(
      {
        org_id: member.org_id,
        phone_number_id: config.phone_number_id,
        business_account_id: config.business_account_id,
        access_token_encrypted: encrypt(config.access_token),
        status: 'connected',
      } as Record<string, unknown>,
      { onConflict: 'org_id' },
    )
    .select('id, phone_number_id, business_account_id, status, created_at, updated_at')
    .single()) as { data: WhatsAppConnectionSafe | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao salvar conexão WhatsApp' };
  }

  return { success: true, data: data! };
}

export async function disconnectWhatsApp(): Promise<ActionResult<{ disconnected: boolean }>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string; role: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  if (member.role !== 'owner' && member.role !== 'admin') {
    return { success: false, error: 'Apenas administradores podem desconectar WhatsApp' };
  }

  const { error } = await from(supabase, 'whatsapp_connections')
    .delete()
    .eq('org_id', member.org_id);

  if (error) {
    return { success: false, error: 'Erro ao desconectar WhatsApp' };
  }

  return { success: true, data: { disconnected: true } };
}

export async function disconnectEvolutionWhatsApp(): Promise<ActionResult<{ disconnected: boolean }>> {
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

  const { error } = await from(supabase, 'whatsapp_instances' as never)
    .delete()
    .eq('org_id', member.org_id);

  if (error) {
    return { success: false, error: 'Erro ao desconectar WhatsApp' };
  }

  return { success: true, data: { disconnected: true } };
}
