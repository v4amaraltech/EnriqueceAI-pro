'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { encrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

interface SaveApi4ComInput {
  ramal: string;
  apiToken?: string;
  baseUrl?: string;
}

export async function saveApi4ComConfig(
  input: SaveApi4ComInput,
): Promise<ActionResult<void>> {
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

  const ramal = input.ramal.trim();
  if (!ramal) {
    return { success: false, error: 'Ramal é obrigatório' };
  }

  const baseUrl = (input.baseUrl?.trim() || 'https://api.api4com.com/api/v1/');

  // Check for existing connection
  const { data: existing } = (await from(supabase, 'api4com_connections' as never)
    .select('id')
    .eq('org_id', member.org_id)
    .eq('user_id', user.id)
    .maybeSingle()) as { data: { id: string } | null };

  if (existing) {
    // Update existing
    const updates: Record<string, unknown> = {
      ramal,
      base_url: baseUrl,
      status: 'connected',
    };

    // Only update api_key if a new one was provided
    if (input.apiToken && input.apiToken.trim()) {
      updates.api_key_encrypted = encrypt(input.apiToken.trim());
    }

    const { error } = await from(supabase, 'api4com_connections' as never)
      .update(updates as Record<string, unknown>)
      .eq('id', existing.id);

    if (error) {
      return { success: false, error: 'Erro ao atualizar configurações' };
    }
  } else {
    // Insert new
    const { error } = await from(supabase, 'api4com_connections' as never)
      .insert({
        org_id: member.org_id,
        user_id: user.id,
        ramal,
        base_url: baseUrl,
        api_key_encrypted: input.apiToken?.trim() ? encrypt(input.apiToken.trim()) : null,
        status: 'connected',
      } as Record<string, unknown>);

    if (error) {
      return { success: false, error: 'Erro ao salvar configurações' };
    }
  }

  // Auto-register webhook for call events (best-effort, don't block on failure)
  try {
    const { registerApi4ComWebhook } = await import('./register-api4com-webhook');
    await registerApi4ComWebhook();
  } catch (err) {
    console.warn('[api4com] Webhook registration failed (non-blocking):', err);
  }

  revalidatePath('/settings/integrations');
  return { success: true, data: undefined };
}

export async function disconnectApi4Com(): Promise<ActionResult<void>> {
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

  const { error } = await from(supabase, 'api4com_connections' as never)
    .delete()
    .eq('org_id', member.org_id)
    .eq('user_id', user.id);

  if (error) {
    return { success: false, error: 'Erro ao desconectar API4Com' };
  }

  revalidatePath('/settings/integrations');
  return { success: true, data: undefined };
}
