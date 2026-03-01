'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

interface SaveThreeCPlusInput {
  extension: string;
  apiToken?: string;
  baseUrl?: string;
}

export async function saveThreeCPlusConfig(
  input: SaveThreeCPlusInput,
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

  const extension = input.extension.trim();
  if (!extension) {
    return { success: false, error: 'Extensão/Ramal é obrigatório' };
  }

  const baseUrl = input.baseUrl?.trim() || 'https://3c.fluxoti.com/api/v1';

  // Check for existing connection
  const { data: existing } = (await (supabase
    .from('threecplus_connections' as never) as ReturnType<typeof supabase.from>)
    .select('id')
    .eq('org_id', member.org_id)
    .eq('user_id', user.id)
    .maybeSingle()) as { data: { id: string } | null };

  if (existing) {
    // Update existing
    const updates: Record<string, unknown> = {
      extension,
      base_url: baseUrl,
      status: 'connected',
    };

    // Only update api_token if a new one was provided
    if (input.apiToken && input.apiToken.trim()) {
      updates.api_token_encrypted = input.apiToken.trim();
    }

    const { error } = await (supabase
      .from('threecplus_connections' as never) as ReturnType<typeof supabase.from>)
      .update(updates as Record<string, unknown>)
      .eq('id', existing.id);

    if (error) {
      return { success: false, error: 'Erro ao atualizar configurações' };
    }
  } else {
    // Insert new
    const { error } = await (supabase
      .from('threecplus_connections' as never) as ReturnType<typeof supabase.from>)
      .insert({
        org_id: member.org_id,
        user_id: user.id,
        extension,
        base_url: baseUrl,
        api_token_encrypted: input.apiToken?.trim() || null,
        status: 'connected',
      } as Record<string, unknown>);

    if (error) {
      return { success: false, error: 'Erro ao salvar configurações' };
    }
  }

  revalidatePath('/settings/integrations');
  return { success: true, data: undefined };
}

export async function disconnectThreeCPlus(): Promise<ActionResult<void>> {
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

  const { error } = await (supabase
    .from('threecplus_connections' as never) as ReturnType<typeof supabase.from>)
    .delete()
    .eq('org_id', member.org_id)
    .eq('user_id', user.id);

  if (error) {
    return { success: false, error: 'Erro ao desconectar 3CPlus' };
  }

  revalidatePath('/settings/integrations');
  return { success: true, data: undefined };
}
