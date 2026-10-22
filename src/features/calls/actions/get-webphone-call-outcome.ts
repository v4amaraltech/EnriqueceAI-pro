'use server';

import { z } from 'zod';

import type { LeadAnswer } from '@/features/integrations/webphone/webphone-lead-answer';
import { leadAnswerFromCallRow } from '@/features/integrations/webphone/webphone-lead-answer';
import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

const inputSchema = z.object({ callId: z.string().uuid() });

export interface WebphoneCallOutcome {
  leadAnswer: LeadAnswer;
  durationSeconds: number;
}

/**
 * O lead atendeu? Lê o que o webhook da API4COM já gravou na linha de `calls`
 * (`answered_at` / `hangup_cause`). O painel flutuante consulta enquanto a
 * resposta for "desconhecido", porque o webhook chega alguns segundos depois
 * de a ligação acabar no navegador.
 */
export async function getWebphoneCallOutcome(input: unknown): Promise<ActionResult<WebphoneCallOutcome>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data: call, error } = (await from(supabase, 'calls')
    .select('answered_at, hangup_cause, duration_seconds')
    .eq('id', parsed.data.callId)
    .eq('org_id', orgId)
    .maybeSingle()) as {
    data: { answered_at: string | null; hangup_cause: string | null; duration_seconds: number | null } | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error('[webphone] getWebphoneCallOutcome lookup failed:', error.message);
    return { success: false, error: 'Erro ao buscar a ligação' };
  }
  if (!call) return { success: false, error: 'Ligação não encontrada' };

  return {
    success: true,
    data: { leadAnswer: leadAnswerFromCallRow(call), durationSeconds: call.duration_seconds ?? 0 },
  };
}
