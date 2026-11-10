'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { isWebphoneLiveAmdEnabled } from '@/features/integrations/webphone/live-amd-flag';

import { mergeLiveAmdMetadata } from '../live-amd-metadata';
import { suggestNextActivity, type NextActivityResult } from '../live-amd-next-activity';

const schema = z.object({
  callId: z.string().uuid(),
  prediction: z.enum(['human', 'no_answer', 'voicemail', 'number_not_exist', 'unknown']),
  phrase: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  latencyMs: z.number().int().min(0),
  predictedAt: z.string().min(1),
  transcript: z.string().max(20_000).optional(),
  requestNextActivity: z.boolean().optional(),
});

export interface RecordLiveAmdResult {
  callId: string;
  nextActivity: NextActivityResult['suggestion'] | null;
  nextActivityReason: string | null;
}

/**
 * Grava calls.metadata.live_amd da ligação desta org. Não escreve
 * sdr_disposition, status nem connected. Não cria atividade e não agenda.
 * A sugestão de próxima atividade só entra no metadata e volta para a tela.
 */
export async function recordLiveAmd(input: unknown): Promise<ActionResult<RecordLiveAmdResult>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const pilot = await isWebphoneLiveAmdEnabled({ orgId, userId });
  if (!pilot) return { success: false, error: 'Piloto desligado' };

  const { callId } = parsed.data;
  const { data: call, error } = (await from(supabase, 'calls')
    .select('id, user_id, metadata')
    .eq('id', callId)
    .eq('org_id', orgId)
    .maybeSingle()) as {
    data: { id: string; user_id: string; metadata: unknown } | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error('[webphone-live-amd] lookup failed:', error.message);
    return { success: false, error: 'Erro ao buscar a ligação' };
  }
  if (!call) return { success: false, error: 'Ligação não encontrada' };
  if (call.user_id !== userId) return { success: false, error: 'Só quem fez a ligação pode gravar a sugestão' };

  let nextActivity: NextActivityResult | null = null;
  if (parsed.data.requestNextActivity) {
    try {
      nextActivity = await suggestNextActivity({
        transcript: parsed.data.transcript ?? '',
        prediction: parsed.data.prediction,
      });
    } catch (err) {
      console.error('[webphone-live-amd] sugestão falhou:', err);
    }
  }

  const metadata = mergeLiveAmdMetadata(call.metadata, { ...parsed.data, nextActivity });
  const { error: updateError } = (await from(supabase, 'calls')
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq('id', callId)
    .eq('org_id', orgId)) as { error: { message: string } | null };

  if (updateError) {
    console.error('[webphone-live-amd] update failed:', updateError.message);
    return { success: false, error: 'Erro ao gravar a sugestão' };
  }

  return {
    success: true,
    data: {
      callId,
      nextActivity: nextActivity?.suggestion ?? null,
      nextActivityReason: nextActivity?.reason ?? null,
    },
  };
}
