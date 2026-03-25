'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { encrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';

interface SaveApi4ComInput {
  ramal: string;
  apiToken?: string;
  baseUrl?: string;
  sipDomain?: string;
  sipPassword?: string;
}

export async function saveApi4ComConfig(
  input: SaveApi4ComInput,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const ramal = input.ramal.trim();
  if (!ramal) {
    return { success: false, error: 'Ramal é obrigatório' };
  }

  const baseUrl = (input.baseUrl?.trim() || 'https://api.api4com.com/api/v1/');

  // Check for existing connection
  const { data: existing } = (await from(supabase, 'api4com_connections' as never)
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()) as { data: { id: string } | null };

  // Build core fields (always present)
  const coreFields: Record<string, unknown> = {
    ramal,
    base_url: baseUrl,
    status: 'connected',
  };

  if (input.apiToken && input.apiToken.trim()) {
    coreFields.api_key_encrypted = encrypt(input.apiToken.trim());
  }

  // SIP fields for webphone (optional — columns may not exist yet)
  const sipFields: Record<string, unknown> = {};
  if (input.sipDomain !== undefined) {
    sipFields.sip_domain = input.sipDomain.trim() || null;
  }
  if (input.sipPassword && input.sipPassword.trim()) {
    sipFields.sip_password_encrypted = encrypt(input.sipPassword.trim());
  }

  if (existing) {
    // Update existing — core fields first
    const { error } = await from(supabase, 'api4com_connections' as never)
      .update({ ...coreFields, ...sipFields } as Record<string, unknown>)
      .eq('id', existing.id);

    if (error) {
      // Retry without SIP fields if they caused the error (columns may not exist)
      if (Object.keys(sipFields).length > 0) {
        const { error: retryError } = await from(supabase, 'api4com_connections' as never)
          .update(coreFields as Record<string, unknown>)
          .eq('id', existing.id);

        if (retryError) {
          console.error('[api4com] Save failed:', retryError);
          return { success: false, error: 'Erro ao atualizar configurações' };
        }
        // Core saved, SIP fields skipped
        console.warn('[api4com] SIP columns not available yet — run migration 20260324210000');
      } else {
        console.error('[api4com] Save failed:', error);
        return { success: false, error: 'Erro ao atualizar configurações' };
      }
    }
  } else {
    // Insert new — try with all fields
    const insertData: Record<string, unknown> = {
      org_id: orgId,
      user_id: userId,
      ...coreFields,
      api_key_encrypted: input.apiToken?.trim() ? encrypt(input.apiToken.trim()) : null,
      ...sipFields,
    };

    const { error } = await from(supabase, 'api4com_connections' as never)
      .insert(insertData as Record<string, unknown>);

    if (error) {
      // Retry without SIP fields
      if (Object.keys(sipFields).length > 0) {
        const { sip_domain: _a, sip_password_encrypted: _b, ...insertWithoutSip } = insertData;
        const { error: retryError } = await from(supabase, 'api4com_connections' as never)
          .insert(insertWithoutSip as Record<string, unknown>);

        if (retryError) {
          console.error('[api4com] Insert failed:', retryError);
          return { success: false, error: 'Erro ao salvar configurações' };
        }
        console.warn('[api4com] SIP columns not available yet — run migration 20260324210000');
      } else {
        console.error('[api4com] Insert failed:', error);
        return { success: false, error: 'Erro ao salvar configurações' };
      }
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
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { error } = await from(supabase, 'api4com_connections' as never)
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error) {
    return { success: false, error: 'Erro ao desconectar API4Com' };
  }

  revalidatePath('/settings/integrations');
  return { success: true, data: undefined };
}
