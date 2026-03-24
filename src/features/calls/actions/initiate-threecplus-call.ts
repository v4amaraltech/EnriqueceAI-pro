'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { manualCallEnter, manualCallDial } from '@/features/integrations/services/threecplus.service';

interface InitiateThreeCPlusCallInput {
  phone: string;
  leadId?: string;
}

interface InitiateThreeCPlusCallResult {
  callId: string;
  threecplusCallId: string;
}

export async function initiateThreeCPlusCall(
  input: InitiateThreeCPlusCallInput,
): Promise<ActionResult<InitiateThreeCPlusCallResult>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  try {
    // Enter manual call mode
    await manualCallEnter(userId);

    // Dial the number
    const dialResult = await manualCallDial(userId, input.phone);

    // Create call record with threecplus_call_id in metadata
    const { data: call, error: callError } = (await supabase
      .from('calls')
      .insert({
        org_id: orgId,
        user_id: userId,
        lead_id: input.leadId ?? null,
        origin: 'threecplus_manual',
        destination: input.phone,
        duration_seconds: 0,
        status: 'not_connected',
        type: 'outbound',
        metadata: {
          threecplus_call_id: dialResult.call_id ?? null,
          provider: 'threecplus',
        },
      })
      .select('id')
      .single()) as { data: { id: string } | null; error: { message: string } | null };

    if (callError || !call) {
      console.error('[3cplus] Failed to create call record:', callError?.message);
      return { success: false, error: 'Erro ao registrar chamada' };
    }

    return {
      success: true,
      data: {
        callId: call.id,
        threecplusCallId: dialResult.call_id ?? call.id,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao iniciar chamada';
    console.error('[3cplus] initiateCall failed:', message);
    return { success: false, error: message };
  }
}

export async function hangupThreeCPlusCall(providerCallId: string): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { userId } = auth.data;

  try {
    const { hangupCall } = await import('@/features/integrations/services/threecplus.service');
    await hangupCall(userId, providerCallId);
    return { success: true, data: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao desligar chamada';
    console.error('[3cplus] hangupCall failed:', message);
    return { success: false, error: message };
  }
}
