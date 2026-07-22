'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { callStatusSchema } from '../schemas/call.schemas';

// `calls.status` continua sendo escrito EXCLUSIVAMENTE pelo webhook do API4COM
// (/api/webhooks/api4com), que classifica significant / no_contact /
// not_connected a partir de hangup_cause + duração. O input manual do SDR já
// sobrescreveu essa medição objetiva com uma subjetiva e produziu a divergência
// que o time de BI reclamou em maio/2026 — por isso nunca mais tocamos em
// `status` aqui.
//
// O que o SDR informa agora vai para `calls.sdr_outcome` (coluna separada,
// migration 20260722120000): a telefonia sabe SE conectou, só o SDR sabe O QUE
// aconteceu na conversa. Os dois convivem, ninguém sobrescreve ninguém.
const classifyInputSchema = z.object({
  callId: z.string().uuid(),
  /** Legado: alguns callers ainda mandam. Nunca aplicado em `calls.status`. */
  status: callStatusSchema.optional(),
  /** Desfecho informado pelo SDR → gravado em `calls.sdr_outcome`. */
  sdrOutcome: callStatusSchema.optional(),
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

  // Fetch current call to check ownership and current state
  const { data: call } = (await from(supabase, 'calls')
    .select('id, duration_seconds, lead_id, org_id')
    .eq('id', callId)
    .eq('org_id', orgId)
    .single()) as { data: { id: string; duration_seconds: number; lead_id: string | null; org_id: string } | null };

  if (!call) {
    return { success: false, error: 'Ligação não encontrada' };
  }

  // `status` DELIBERADAMENTE omitido — quem manda nele é o webhook do API4COM.
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (notes) {
    updates.notes = notes;
  }

  // O desfecho do SDR vai para a coluna própria, ao lado do status técnico.
  if (sdrOutcome) {
    updates.sdr_outcome = sdrOutcome;
  }

  // Use client-side duration as fallback if webhook hasn't set it
  if (call.duration_seconds === 0 && clientDurationSeconds > 0) {
    updates.duration_seconds = clientDurationSeconds;
  }

  // Only write if we have a meaningful change (notes or duration); otherwise
  // skip — there's no point flipping updated_at for an empty submission.
  if (Object.keys(updates).length > 1) {
    await from(supabase, 'calls').update(updates).eq('id', callId).eq('org_id', orgId);
  }

  // Atualiza a interaction `internal_api4com` que initiateApi4ComCall já
  // criou pra esta ligação — em vez de inserir uma nova. Antes, classify
  // sempre criava uma row separada com `source=webphone`, fazendo 1 ligação
  // virar 2 (e até 3, somando o INSERT da execução de cadência) no contador
  // de "atividades realizadas". Hoje (27/05/2026) a V4 Amaral acumulou
  // 257 phone interactions fantasmas em 302 ligações reais.
  //
  // Mantém o INSERT como fallback se o internal_api4com ainda não estiver
  // gravado (legacy ou casos raros onde initiate não inseriu).
  const effectiveLeadId = leadId ?? call.lead_id;
  if (effectiveLeadId) {
    const { data: existing } = (await from(supabase, 'interactions')
      .select('id, metadata, message_content')
      .eq('lead_id', effectiveLeadId)
      .eq('channel', 'phone')
      .contains('metadata', { callId })
      .limit(1)
      .maybeSingle()) as { data: { id: string; metadata: Record<string, unknown> | null; message_content: string | null } | null };

    if (existing) {
      const mergedMeta = {
        ...(existing.metadata ?? {}),
        classified_via: 'webphone',
        ...(notes ? { webphone_notes: notes } : {}),
      };
      await from(supabase, 'interactions')
        .update({
          ...(notes && !existing.message_content ? { message_content: notes } : {}),
          metadata: mergedMeta,
        } as Record<string, unknown>)
        .eq('id', existing.id);
    } else {
      await from(supabase, 'interactions')
        .insert({
          org_id: orgId,
          lead_id: effectiveLeadId,
          channel: 'phone',
          type: 'sent',
          message_content: notes || null,
          metadata: { callId, source: 'webphone' },
          performed_by: userId,
        } as Record<string, unknown>);
    }
  }

  return { success: true, data: { callId } };
}
