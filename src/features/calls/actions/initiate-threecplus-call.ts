'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { click2call } from '@/features/integrations/services/threecplus.service';

interface InitiateCallInput {
  phone: string;
  leadId?: string;
}

interface InitiateCallResult {
  callId: string;
  threecplusCallId: string;
}

export async function initiateThreeCPlusCall(
  input: InitiateCallInput,
): Promise<ActionResult<InitiateCallResult>> {
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

  try {
    const { data: threecplusResponse, extension } = await click2call(user.id, input.phone);

    // Create call record with threecplus_call_id in metadata for correlation
    const { data: call, error: callError } = (await supabase
      .from('calls')
      .insert({
        org_id: member.org_id,
        user_id: user.id,
        lead_id: input.leadId ?? null,
        origin: extension,
        destination: input.phone,
        duration_seconds: 0,
        status: 'not_connected',
        type: 'outbound',
        metadata: { threecplus_call_id: threecplusResponse.id },
      })
      .select('id')
      .single()) as { data: { id: string } | null; error: { message: string } | null };

    if (callError || !call) {
      console.error('[3cplus] Failed to create call record:', callError?.message);
      return { success: false, error: 'Erro ao registrar chamada' };
    }

    return {
      success: true,
      data: { callId: call.id, threecplusCallId: threecplusResponse.id },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao iniciar chamada';
    console.error('[3cplus] click2call failed:', message);
    return { success: false, error: message };
  }
}

export async function hangupThreeCPlusCall(
  threecplusCallId: string,
): Promise<ActionResult<void>> {
  const user = await requireAuth();

  try {
    const { hangupCall } = await import('@/features/integrations/services/threecplus.service');
    await hangupCall(user.id, threecplusCallId);
    return { success: true, data: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao desligar chamada';
    console.error('[3cplus] hangupCall failed:', message);
    return { success: false, error: message };
  }
}
