'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { dialerPreferencesSchema } from '../schemas/dialer-preferences.schemas';

export async function saveDialerPreferences(
  raw: Record<string, unknown>,
): Promise<ActionResult<{ saved: true }>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Apenas managers podem alterar preferências' };
  }

  const parsed = dialerPreferencesSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const input = parsed.data;

  // Check if settings row exists
  const { data: existing } = (await supabase
    .from('organization_call_settings')
    .select('id')
    .eq('org_id', orgId)
    .single()) as { data: { id: string } | null };

  if (existing) {
    const { error } = await from(supabase, 'organization_call_settings')
      .update({
        dialer_simultaneous_phones: input.simultaneous_phones,
        dialer_daily_limit_per_lead: input.daily_limit_per_lead,
      })
      .eq('org_id', orgId);

    if (error) return { success: false, error: 'Erro ao salvar preferências' };
  } else {
    const { error } = await from(supabase, 'organization_call_settings')
      .insert({
        org_id: orgId,
        dialer_simultaneous_phones: input.simultaneous_phones,
        dialer_daily_limit_per_lead: input.daily_limit_per_lead,
      });

    if (error) return { success: false, error: 'Erro ao criar preferências' };
  }

  revalidatePath('/settings/calls');
  return { success: true, data: { saved: true } };
}
