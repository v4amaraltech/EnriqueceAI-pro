'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { originateCall } from '@/features/integrations/services/api4com.service';
import { normalizePhone } from '@/lib/utils/phone';

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

  // Strip the phone before persisting so the recovery cron + recording lookup
  // can match against API4COM's record list (which always returns digit-only
  // numbers). Saving formatted strings like "31 9621-1619" here was the cause
  // of 514 unmatched recordings on V4 Amaral.
  const normalizedPhone = normalizePhone(input.phone);

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
        destination: normalizedPhone,
        duration_seconds: 0,
        status: 'not_connected',
        type: 'outbound',
        metadata: { api4com_call_id: api4comResponse.id, gateway },
      })
      .select('id')
      .single()) as { data: { id: string } | null; error: { message: string } | null };

    const qErr = handleQueryError(callError, 'Erro ao registrar chamada', 'api4com');
    if (qErr || !call) return qErr ?? { success: false, error: 'Erro ao registrar chamada' };

    // Mirror the call into `interactions` so it shows up in the lead timeline.
    // Webhook-driven external calls already get this via `createExternalCallInteraction`;
    // calls initiated from the "Ligar" button skipped it, so they ended up
    // invisible in the timeline (the manager could only see them in /calls).
    // Linking via `metadata.callId` lets fetch-interactions enrich the row with
    // recording_url/transcription/duration once the webhook updates the call.
    if (input.leadId) {
      const interactionInsert = await from(supabase, 'interactions')
        .insert({
          org_id: orgId,
          lead_id: input.leadId,
          type: 'sent',
          channel: 'phone',
          message_content: `Ligação iniciada pela plataforma para ${normalizedPhone}`,
          performed_by: userId,
          metadata: {
            source: 'internal_api4com',
            callId: call.id,
            api4com_id: api4comResponse.id,
            ramal,
          },
        } as Record<string, unknown>);
      if ((interactionInsert as { error?: { message: string } }).error) {
        console.error(
          '[api4com] Failed to log call interaction:',
          (interactionInsert as { error: { message: string } }).error.message,
        );
      }
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
