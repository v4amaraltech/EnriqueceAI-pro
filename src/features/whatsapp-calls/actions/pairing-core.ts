import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActionResult } from '@/lib/actions/action-result';
import { from } from '@/lib/supabase/from';

import type { PairingResult } from '../pairing-types';
import {
  VoiceServiceError,
  createVoiceSession,
  deleteVoiceSession,
  getVoiceSession,
} from '../services/voice-service-client';

/**
 * Núcleo de pareamento compartilhado pelos dois caminhos:
 *  - manager (`actions/pairing.ts`): pareia qualquer SDR da org, escrita via
 *    client do usuário (RLS permite manager), escopo só por `org_id`;
 *  - self-service (`actions/pairing-self.ts`): o SDR pareia o próprio número,
 *    escrita via service role, escopo por `org_id` + `user_id`.
 *
 * A diferença de segurança é o parâmetro `userId`: quando presente, leitura/
 * escrita são escopadas também por `user_id` (defense-in-depth do self-service).
 */
export function mapVoiceError(err: unknown): { success: false; error: string } {
  if (err instanceof VoiceServiceError) {
    if (err.code === 'not_configured') {
      return { success: false, error: 'Serviço de voz WhatsApp não configurado. Avise o admin.' };
    }
    return { success: false, error: err.message };
  }
  return { success: false, error: 'Erro inesperado no serviço de voz' };
}

/**
 * Cria/reinicia o pareamento do número de `targetUserId`. SEMPRE cria uma sessão
 * NOVA no serviço (QR fresco), limpando a anterior antes — robusto contra sessão
 * morta (o re-pair de um sid inexistente dá 400). `client` é quem tem permissão
 * de escrita (server p/ manager via RLS; service role p/ self).
 */
export async function createPairingCore(
  client: SupabaseClient,
  orgId: string,
  targetUserId: string,
): Promise<ActionResult<PairingResult>> {
  const { data: existing } = (await from(client, 'whatsapp_call_sessions')
    .select('id, service_session_id')
    .eq('org_id', orgId)
    .eq('user_id', targetUserId)
    .maybeSingle()) as { data: { id: string; service_session_id: string | null } | null };

  if (existing?.service_session_id) {
    try {
      await deleteVoiceSession(existing.service_session_id);
    } catch {
      // best-effort: a sessão antiga pode já não existir no serviço
    }
  }

  let voice;
  try {
    voice = await createVoiceSession(targetUserId);
  } catch (err) {
    return mapVoiceError(err);
  }

  if (existing) {
    await from(client, 'whatsapp_call_sessions')
      .update({ service_session_id: voice.sid, status: 'pairing', phone_number: null } as Record<string, unknown>)
      .eq('id', existing.id);
  } else {
    await from(client, 'whatsapp_call_sessions').insert({
      org_id: orgId,
      user_id: targetUserId,
      service_session_id: voice.sid,
      status: 'pairing',
    } as Record<string, unknown>);
  }

  return {
    success: true,
    data: { sid: voice.sid, status: voice.status, qr: voice.qr, phoneNumber: voice.phoneNumber },
  };
}

/**
 * Consulta o estado do pareamento (polling/confirmação) e persiste quando conecta.
 * Quando `userId` é passado (self), confirma a posse da sessão antes de tocar nela
 * e escopa a escrita por `user_id`.
 */
export async function getPairingStatusCore(
  client: SupabaseClient,
  orgId: string,
  sid: string,
  userId?: string,
): Promise<ActionResult<PairingResult>> {
  if (userId) {
    const { data: own } = (await from(client, 'whatsapp_call_sessions')
      .select('id')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .eq('service_session_id', sid)
      .maybeSingle()) as { data: { id: string } | null };
    if (!own) return { success: false, error: 'Sessão não pertence a você' };
  }

  let voice;
  try {
    voice = await getVoiceSession(sid);
  } catch (err) {
    return mapVoiceError(err);
  }
  if (!voice) return { success: false, error: 'Sessão não encontrada no serviço de voz' };

  const patch: Record<string, unknown> =
    voice.status === 'connected'
      ? { status: 'connected', phone_number: voice.phoneNumber, paired_at: new Date().toISOString() }
      : { status: voice.status };

  let update = from(client, 'whatsapp_call_sessions')
    .update(patch)
    .eq('org_id', orgId)
    .eq('service_session_id', sid);
  if (userId) update = update.eq('user_id', userId);
  await update;

  return {
    success: true,
    data: { sid, status: voice.status, qr: voice.qr, phoneNumber: voice.phoneNumber },
  };
}

/**
 * Cancela um pareamento em andamento (diálogo fechado sem parear): remove a
 * sessão do serviço e a linha local se ainda não conectada. Com `userId`, escopa
 * por usuário (self).
 */
export async function cancelPairingCore(
  client: SupabaseClient,
  orgId: string,
  sid: string,
  userId?: string,
): Promise<ActionResult<{ canceled: true }>> {
  try {
    await deleteVoiceSession(sid);
  } catch {
    // best-effort
  }

  let del = from(client, 'whatsapp_call_sessions')
    .delete()
    .eq('org_id', orgId)
    .eq('service_session_id', sid)
    .neq('status', 'connected');
  if (userId) del = del.eq('user_id', userId);
  await del;

  return { success: true, data: { canceled: true } };
}
