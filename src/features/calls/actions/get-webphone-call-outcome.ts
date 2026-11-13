'use server';

import { z } from 'zod';

import type { LeadAnswer } from '@/features/integrations/webphone/webphone-lead-answer';
import { leadAnswerFromCallRow } from '@/features/integrations/webphone/webphone-lead-answer';
import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import {
  type AutoUpdateMarkerView,
  type LiveAmdSuggestionInput,
  readAutoUpdateMarkerView,
  readLiveAmdSuggestion,
} from '../post-call-suggestion';

const inputSchema = z.object({ callId: z.string().uuid() });

export interface WebphoneCallOutcome {
  leadAnswer: LeadAnswer;
  durationSeconds: number;
  /** Causa do fim gravada pelo webhook — o painel mostra o motivo quando o lead não atende. */
  hangupCause: string | null;
  /** Desfecho já gravado (SDR ou escrita automática). */
  sdrDisposition: string | null;
  /** Marcador da escrita automática, se já ocorreu. */
  autoUpdateMarker: AutoUpdateMarkerView | null;
  /** Sugestão da escuta ao vivo gravada em metadata.live_amd. */
  liveAmd: LiveAmdSuggestionInput | null;
}

/**
 * O lead atendeu? Lê o que o webhook da API4COM já gravou na linha de `calls`
 * (`answered_at` / `hangup_cause`). Também devolve o desfecho e as sugestões
 * já persistidas (marcador crm_auto_update e live_amd), para o modal de
 * resultado pré-selecionar ou mostrar que o CRM já foi preenchido.
 * O painel flutuante consulta enquanto a resposta for "desconhecido", porque
 * o webhook chega alguns segundos depois de a ligação acabar no navegador.
 */
export async function getWebphoneCallOutcome(
  input: unknown,
): Promise<ActionResult<WebphoneCallOutcome>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data: call, error } = (await from(supabase, 'calls')
    .select('answered_at, hangup_cause, duration_seconds, sdr_disposition, metadata')
    .eq('id', parsed.data.callId)
    .eq('org_id', orgId)
    .maybeSingle()) as {
    data: {
      answered_at: string | null;
      hangup_cause: string | null;
      duration_seconds: number | null;
      sdr_disposition: string | null;
      metadata: unknown;
    } | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error('[webphone] getWebphoneCallOutcome lookup failed:', error.message);
    return { success: false, error: 'Erro ao buscar a ligação' };
  }
  if (!call) return { success: false, error: 'Ligação não encontrada' };

  return {
    success: true,
    data: {
      leadAnswer: leadAnswerFromCallRow(call),
      durationSeconds: call.duration_seconds ?? 0,
      hangupCause: call.hangup_cause,
      sdrDisposition: call.sdr_disposition ?? null,
      autoUpdateMarker: readAutoUpdateMarkerView(call.metadata),
      liveAmd: readLiveAmdSuggestion(call.metadata),
    },
  };
}
