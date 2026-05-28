'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { CallRow } from '../types';
import { createCallSchema } from '../schemas/call.schemas';

export async function createCall(
  rawInput: Record<string, unknown>,
): Promise<ActionResult<CallRow>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const parsed = createCallSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const { data, error } = (await from(supabase, 'calls')
    .insert({
      ...parsed.data,
      org_id: orgId,
      user_id: userId,
    })
    .select()
    .single()) as { data: CallRow | null; error: { message: string } | null };

  if (error || !data) {
    return { success: false, error: 'Erro ao registrar ligação' };
  }

  // Mirror manually-logged calls onto the lead timeline as a phone interaction.
  // The lead timeline reads only from `interactions`; without this, a call
  // logged on the /calls page never appears in the lead's history. Linking via
  // metadata.callId lets fetchLeadTimeline enrich it with recording/duration.
  if (parsed.data.lead_id) {
    await from(supabase, 'interactions').insert({
      org_id: orgId,
      lead_id: parsed.data.lead_id,
      channel: 'phone',
      type: 'sent',
      message_content: parsed.data.notes ?? null,
      metadata: { callId: data.id, source: 'manual_call' },
      performed_by: userId,
    } as Record<string, unknown>);
  }

  revalidatePath('/calls');
  return { success: true, data };
}
