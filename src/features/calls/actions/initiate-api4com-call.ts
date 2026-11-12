'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import {
  describeOriginateError,
  getUserCredentials,
  isRamalLegFailure,
  originateCall,
} from '@/features/integrations/services/api4com.service';
import { originateApi4ComCallWithRef } from '@/features/calls/services/originate-api4com-call.service';
import { createServiceRoleClient } from '@/lib/supabase/service';

const initiateCallSchema = z.object({
  phone: z.string().min(8, 'Telefone inválido'),
  leadId: z.string().uuid().optional(),
  contactId: z.string().uuid().nullable().optional(),
  extraMetadata: z.record(z.string()).optional(),
});

const callIdSchema = z.string().min(1, 'ID da chamada é obrigatório');

interface InitiateCallInput {
  phone: string;
  leadId?: string;
  contactId?: string | null;
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

  // A linha nasce antes do POST, com calls.id enviado em metadata.callRef.
  // Ver originate-api4com-call.service.ts.
  return originateApi4ComCallWithRef(
    {
      supabase,
      orgId,
      userId,
      getCredentials: getUserCredentials,
      originate: (uid, phone, metadata, credentials) => originateCall(uid, phone, metadata, { credentials }),
      randomUUID: () => crypto.randomUUID(),
      isRamalLegFailure,
      describeOriginateError: (message) => describeOriginateError(message),
      // Só é chamado no 424. A policy calls_delete exige gestor; o service
      // role apaga só o id desta tentativa (com org e user no filtro).
      getDeleteClient: createServiceRoleClient,
    },
    input,
  );
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
