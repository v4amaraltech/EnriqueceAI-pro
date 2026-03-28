'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
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
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { data: roleData } = (await supabase
    .from('organization_members')
    .select('role')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()) as { data: { role: string } | null };

  if (roleData?.role !== 'owner' && roleData?.role !== 'admin') {
    return { success: false, error: 'Apenas administradores podem configurar WhatsApp' };
  }

  if (!config.phone_number_id || !config.business_account_id || !config.access_token) {
    return { success: false, error: 'Todos os campos são obrigatórios' };
  }

  // Upsert connection (1 per org)
  const { data, error } = (await from(supabase, 'whatsapp_connections')
    .upsert(
      {
        org_id: orgId,
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

  revalidatePath('/settings/integrations');
  return { success: true, data: data! };
}

export async function disconnectWhatsApp(): Promise<ActionResult<{ disconnected: boolean }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { data: roleData } = (await supabase
    .from('organization_members')
    .select('role')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()) as { data: { role: string } | null };

  if (roleData?.role !== 'owner' && roleData?.role !== 'admin') {
    return { success: false, error: 'Apenas administradores podem desconectar WhatsApp' };
  }

  const { error } = await from(supabase, 'whatsapp_connections')
    .delete()
    .eq('org_id', orgId);

  if (error) {
    return { success: false, error: 'Erro ao desconectar WhatsApp' };
  }

  revalidatePath('/settings/integrations');
  return { success: true, data: { disconnected: true } };
}

export async function disconnectEvolutionWhatsApp(): Promise<ActionResult<{ disconnected: boolean }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  // Call edge function that handles Evolution API logout + DB delete
  const { error } = await supabase.functions.invoke('evolution-disconnect', {
    method: 'POST',
  });

  if (error) {
    console.error('[disconnectEvolutionWhatsApp] Edge function error:', error);
    return { success: false, error: 'Erro ao desconectar WhatsApp' };
  }

  revalidatePath('/settings/integrations');
  return { success: true, data: { disconnected: true } };
}
