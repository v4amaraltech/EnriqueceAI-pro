'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { callDispositionSchema, callStatusSchema } from '../schemas/call.schemas';
import { applySdrCallResult } from '../services/apply-sdr-call-result';

// `calls.status` continua sendo escrito EXCLUSIVAMENTE pelo webhook do API4COM
// (/api/webhooks/api4com), que classifica significant / no_contact /
// not_connected a partir de hangup_cause + duração. O input manual do SDR já
// sobrescreveu essa medição objetiva com uma subjetiva e produziu a divergência
// que o time de BI reclamou em maio/2026 — por isso nunca mais tocamos em
// `status` aqui.
//
// O que o SDR informa agora vai para `calls.sdr_disposition` (coluna e enum
// próprios, migration 20260801210000): a telefonia sabe SE conectou, só o SDR
// sabe O QUE aconteceu na conversa. Os dois convivem, ninguém sobrescreve ninguém.
const classifyInputSchema = z.object({
  callId: z.string().uuid(),
  /** Legado: alguns callers ainda mandam. Nunca aplicado em `calls.status`. */
  status: callStatusSchema.optional(),
  /** Desfecho informado pelo SDR → gravado em `calls.sdr_disposition`. */
  sdrOutcome: callDispositionSchema.optional(),
  clientDurationSeconds: z.number().int().min(0),
  notes: z.string().optional(),
  leadId: z.string().uuid().optional(),
});

export async function classifyWebphoneCall(
  input: z.infer<typeof classifyInputSchema>,
): Promise<ActionResult<{ callId: string }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const parsed = classifyInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'Dados inválidos' };
  }

  const { callId, sdrOutcome, clientDurationSeconds, notes, leadId } = parsed.data;

  const result = await applySdrCallResult(supabase, {
    orgId,
    userId,
    callId,
    sdrOutcome,
    clientDurationSeconds,
    notes,
    leadId,
    via: 'webphone',
  });
  if (!result.success) return result;

  return { success: true, data: { callId } };
}
