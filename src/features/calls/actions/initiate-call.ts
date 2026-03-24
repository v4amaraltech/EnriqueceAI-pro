'use server';

import type { ActionResult } from '@/lib/actions/action-result';

import type { DialerProvider, InitiateCallResult } from '../types/dialer-provider';

interface InitiateCallInput {
  provider: DialerProvider;
  phone: string;
  leadId?: string;
}

/**
 * Unified call initiation dispatcher.
 * Routes to the correct provider's implementation.
 */
export async function initiateCall(
  input: InitiateCallInput,
): Promise<ActionResult<InitiateCallResult>> {
  if (!input.provider) {
    return { success: false, error: 'Nenhum provedor de telefonia configurado' };
  }

  if (input.provider === 'api4com') {
    const { initiateApi4ComCall } = await import('./initiate-api4com-call');
    const result = await initiateApi4ComCall({
      phone: input.phone,
      leadId: input.leadId,
    });
    if (!result.success) return result;
    return {
      success: true,
      data: { callId: result.data.callId, providerCallId: result.data.api4comId },
    };
  }

  if (input.provider === 'threecplus') {
    const { initiateThreeCPlusCall } = await import('./initiate-threecplus-call');
    const result = await initiateThreeCPlusCall({
      phone: input.phone,
      leadId: input.leadId,
    });
    if (!result.success) return result;
    return {
      success: true,
      data: { callId: result.data.callId, providerCallId: result.data.threecplusCallId },
    };
  }

  return { success: false, error: `Provedor desconhecido: ${input.provider as string}` };
}

/**
 * Unified hangup dispatcher.
 */
export async function hangupCall(
  provider: DialerProvider,
  providerCallId?: string,
): Promise<ActionResult<void>> {
  if (!provider) {
    return { success: false, error: 'Nenhum provedor de telefonia configurado' };
  }

  if (provider === 'api4com') {
    if (!providerCallId) return { success: false, error: 'ID da chamada API4COM não fornecido' };
    const { hangupApi4ComCall } = await import('./initiate-api4com-call');
    return hangupApi4ComCall(providerCallId);
  }

  if (provider === 'threecplus') {
    const { hangupThreeCPlusCall } = await import('./initiate-threecplus-call');
    return hangupThreeCPlusCall();
  }

  return { success: false, error: `Provedor desconhecido: ${provider as string}` };
}
