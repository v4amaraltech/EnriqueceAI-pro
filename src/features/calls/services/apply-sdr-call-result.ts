import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActionResult } from '@/lib/actions/action-result';
import { from } from '@/lib/supabase/from';

import type { CallDisposition } from '../types';

export interface ApplySdrCallResultInput {
  orgId: string;
  userId: string;
  callId: string;
  /** Desfecho informado pelo SDR → `calls.sdr_disposition`. */
  sdrOutcome?: CallDisposition;
  /** Segundos medidos na tela (reserva enquanto o webhook não fechou a ligação). */
  clientDurationSeconds: number;
  notes?: string;
  /**
   * Revisão do texto no cliente. Uma gravação com revisão menor não substitui
   * nota mais nova nem apaga desfecho. Sem o campo, o comportamento anterior
   * permanece.
   */
  notesRev?: number;
  leadId?: string;
  /**
   * Campos extras da interação de telefone desta ligação (ex.: `cadence_id` e
   * `step_id` quando o Power Dialer conclui a etapa da cadência).
   */
  interactionFields?: Record<string, unknown>;
  /** `metadata.classified_via` / `metadata.source` da interação. */
  via: 'webphone' | 'power_dialer';
}

/**
 * Grava o resultado que o SDR informou para uma ligação JÁ registrada em
 * `calls` (criada pelo `initiateCall`). Não cria outra linha em `calls`.
 *
 * - `calls.status` NUNCA é escrito aqui: é do webhook da API4COM (medição
 *   objetiva). O SDR vai para `sdr_disposition` e `notes`.
 * - Duração da tela só como reserva enquanto o webhook não fechou a ligação
 *   (`hangup_cause` vazio). Com `hangup_cause`, o 0 s do webhook é "ninguém
 *   atendeu" — o tempo da tela é da perna do ramal (22/10/2026).
 * - Atualiza a interação `internal_api4com` desta ligação em vez de inserir
 *   outra (1 ligação = 1 atividade realizada); insere só se ela não existir.
 */
export async function applySdrCallResult(
  supabase: SupabaseClient,
  input: ApplySdrCallResultInput,
): Promise<ActionResult<{ callId: string; leadId: string | null; notesApplied: boolean }>> {
  const { orgId, userId, callId, sdrOutcome, clientDurationSeconds, notes, notesRev, leadId, interactionFields, via } = input;

  const { data: call } = (await from(supabase, 'calls')
    .select('id, duration_seconds, lead_id, org_id, hangup_cause')
    .eq('id', callId)
    .eq('org_id', orgId)
    .single()) as {
    data: { id: string; duration_seconds: number; lead_id: string | null; org_id: string; hangup_cause: string | null } | null;
  };

  if (!call) {
    return { success: false, error: 'Ligação não encontrada' };
  }

  // A interaction é lida antes da escrita para uma revisão velha não cobrir
  // nota mais nova. Desfecho, quando vem, continua sendo aplicado.
  const effectiveLeadIdForRev = leadId ?? call.lead_id;
  let existingForRev: { id: string; metadata: Record<string, unknown> | null; message_content: string | null } | null = null;
  if (effectiveLeadIdForRev && notesRev != null) {
    const { data: existingEarly } = (await from(supabase, 'interactions')
      .select('id, metadata, message_content')
      .eq('lead_id', effectiveLeadIdForRev)
      .eq('channel', 'phone')
      .contains('metadata', { callId })
      .limit(1)
      .maybeSingle()) as { data: { id: string; metadata: Record<string, unknown> | null; message_content: string | null } | null };
    existingForRev = existingEarly;
  }
  const previousRev = typeof existingForRev?.metadata?.webphone_notes_rev === 'number' ? existingForRev.metadata.webphone_notes_rev : 0;
  const notesStale = notesRev != null && notesRev < previousRev;
  const notesToWrite = notes && !notesStale ? notes : undefined;

  // `status` DELIBERADAMENTE omitido — quem manda nele é o webhook do API4COM.
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (notesToWrite) updates.notes = notesToWrite;
  if (sdrOutcome) updates.sdr_disposition = sdrOutcome;
  if (call.duration_seconds === 0 && clientDurationSeconds > 0 && !call.hangup_cause) {
    updates.duration_seconds = clientDurationSeconds;
  }
  // Nada além de updated_at: não vale a escrita.
  if (Object.keys(updates).length > 1) {
    await from(supabase, 'calls').update(updates).eq('id', callId).eq('org_id', orgId);
  }

  // Atualiza a interaction `internal_api4com` que initiateApi4ComCall já
  // criou pra esta ligação — em vez de inserir uma nova. Antes, cada caminho
  // criava a sua (`source=webphone`, `source=power_dialer`), fazendo 1 ligação
  // virar 2 ou 3 no contador de "atividades realizadas" (27/05/2026: 257
  // interactions fantasmas em 302 ligações reais na V4 Amaral).
  const effectiveLeadId = leadId ?? call.lead_id;
  if (effectiveLeadId && (notesToWrite || sdrOutcome || interactionFields || !existingForRev)) {
    const existing =
      existingForRev ??
      ((await from(supabase, 'interactions')
        .select('id, metadata, message_content')
        .eq('lead_id', effectiveLeadId)
        .eq('channel', 'phone')
        .contains('metadata', { callId })
        .limit(1)
        .maybeSingle()) as { data: { id: string; metadata: Record<string, unknown> | null; message_content: string | null } | null }).data;

    if (existing) {
      const mergedMeta = {
        ...(existing.metadata ?? {}),
        classified_via: via,
        ...(notesToWrite ? { webphone_notes: notesToWrite, ...(notesRev != null ? { webphone_notes_rev: notesRev } : {}) } : {}),
      };
      await from(supabase, 'interactions')
        .update({
          ...(interactionFields ?? {}),
          ...(notesToWrite && !existing.message_content ? { message_content: notesToWrite } : {}),
          metadata: mergedMeta,
        } as Record<string, unknown>)
        .eq('id', existing.id);
    } else if (notesToWrite || sdrOutcome || interactionFields) {
      await from(supabase, 'interactions').insert({
        org_id: orgId,
        lead_id: effectiveLeadId,
        channel: 'phone',
        type: 'sent',
        message_content: notesToWrite || null,
        metadata: { callId, source: via, ...(notesRev != null && notesToWrite ? { webphone_notes_rev: notesRev } : {}) },
        performed_by: userId,
        ...(interactionFields ?? {}),
      } as Record<string, unknown>);
    }
  }

  return { success: true, data: { callId, leadId: effectiveLeadId, notesApplied: !notes || Boolean(notesToWrite) } };
}
