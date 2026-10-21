'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { mergeWebphoneAudioMetadata, saveWebphoneCallAudioSchema } from '../schemas/webphone-audio.schemas';

/**
 * Grava em `calls.metadata` a avaliação de áudio (1–5 estrelas) e/ou o resumo
 * de `getStats()` da ligação feita pelo webphone no navegador. Só o próprio
 * autor da ligação (mesma org e `calls.user_id`) pode gravar. Nunca toca em
 * `status`, `duration_seconds` ou nas demais colunas — isso é do webhook.
 */
export async function saveWebphoneCallAudio(input: unknown): Promise<ActionResult<{ callId: string }>> {
  const parsed = saveWebphoneCallAudioSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { callId, audioQuality, audioStats } = parsed.data;

  const { data: call, error } = (await from(supabase, 'calls')
    .select('id, user_id, metadata')
    .eq('id', callId)
    .eq('org_id', orgId)
    .maybeSingle()) as {
    data: { id: string; user_id: string; metadata: unknown } | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error('[webphone] saveWebphoneCallAudio lookup failed:', error.message);
    return { success: false, error: 'Erro ao buscar a ligação' };
  }
  if (!call) return { success: false, error: 'Ligação não encontrada' };
  if (call.user_id !== userId) return { success: false, error: 'Só quem fez a ligação pode avaliar o áudio' };

  const metadata = mergeWebphoneAudioMetadata(call.metadata, { audioQuality, audioStats });

  const { error: updateError } = (await from(supabase, 'calls')
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq('id', callId)
    .eq('org_id', orgId)) as { error: { message: string } | null };

  if (updateError) {
    console.error('[webphone] saveWebphoneCallAudio update failed:', updateError.message);
    return { success: false, error: 'Erro ao gravar a avaliação' };
  }

  return { success: true, data: { callId } };
}
