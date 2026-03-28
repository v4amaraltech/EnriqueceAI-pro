'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { originateCall } from '@/features/integrations/services/api4com.service';

const initiateCallSchema = z.object({
  phone: z.string().min(8, 'Telefone inválido'),
  leadId: z.string().uuid().optional(),
  extraMetadata: z.record(z.string()).optional(),
});

const callIdSchema = z.string().min(1, 'ID da chamada é obrigatório');

interface InitiateCallInput {
  phone: string;
  leadId?: string;
  extraMetadata?: Record<string, string>;
}

interface InitiateCallResult {
  callId: string;
  api4comId: string;
}

export async function initiateApi4ComCall(
  input: InitiateCallInput,
): Promise<ActionResult<InitiateCallResult>> {
  const parsed = initiateCallSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const gateway = `flux-${orgId}`;

  try {
    const { data: api4comResponse, ramal } = await originateCall(userId, input.phone, {
      gateway,
      ...input.extraMetadata,
    });

    // Create call record with api4com_call_id in metadata for webhook correlation
    const { data: call, error: callError } = (await from(supabase, 'calls')
      .insert({
        org_id: orgId,
        user_id: userId,
        lead_id: input.leadId ?? null,
        origin: ramal,
        destination: input.phone,
        duration_seconds: 0,
        status: 'not_connected',
        type: 'outbound',
        metadata: { api4com_call_id: api4comResponse.id, gateway },
      })
      .select('id')
      .single()) as { data: { id: string } | null; error: { message: string } | null };

    if (callError || !call) {
      console.error('[api4com] Failed to create call record:', callError?.message);
      return { success: false, error: 'Erro ao registrar chamada' };
    }

    return {
      success: true,
      data: { callId: call.id, api4comId: api4comResponse.id },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao iniciar chamada';
    console.error('[api4com] originateCall failed:', message);
    return { success: false, error: message };
  }
}

export async function hangupApi4ComCall(
  api4comCallId: string,
): Promise<ActionResult<void>> {
  const idParsed = callIdSchema.safeParse(api4comCallId);
  if (!idParsed.success) return { success: false, error: 'ID inválido' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { userId } = auth.data;

  try {
    const { hangupCall } = await import('@/features/integrations/services/api4com.service');
    await hangupCall(userId, api4comCallId);
    return { success: true, data: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao desligar chamada';
    console.error('[api4com] hangupCall failed:', message);
    return { success: false, error: message };
  }
}
