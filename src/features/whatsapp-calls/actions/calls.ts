'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { DAILY_CALL_LIMIT } from '../constants';
import { toE164BR } from '../phone';
import {
  VoiceServiceError,
  endVoiceCall,
  exchangeVoiceSdp,
  startVoiceCall,
} from '../services/voice-service-client';

function mapVoiceError(err: unknown): { success: false; error: string } {
  if (err instanceof VoiceServiceError) {
    if (err.code === 'not_configured') {
      return { success: false, error: 'Serviço de voz WhatsApp não configurado. Avise o admin.' };
    }
    return { success: false, error: err.message };
  }
  return { success: false, error: 'Erro inesperado no serviço de voz' };
}

const startSchema = z.object({ phone: z.string().min(8, 'Número inválido') });
const endSchema = z.object({ sid: z.string().min(1), callId: z.string().min(1) });
const sdpSchema = z.object({
  sid: z.string().min(1),
  callId: z.string().min(1),
  sdpOffer: z.string().min(1),
});

/**
 * Inicia uma Ligação via WhatsApp (story 7.5). Resolve a sessão pareada do SDR
 * logado e dispara a chamada no microserviço. Retorna {sid, callId} para o
 * painel conduzir o handshake de mídia (7.1) e o encerramento.
 */
export async function startWhatsAppCall(
  input: z.infer<typeof startSchema>,
): Promise<ActionResult<{ sid: string; callId: string }>> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Número inválido' };

  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: session } = (await from(supabase, 'whatsapp_call_sessions')
    .select('service_session_id, status')
    .eq('user_id', user.id)
    .eq('status', 'connected')
    .maybeSingle()) as { data: { service_session_id: string; status: string } | null };

  if (!session) {
    return { success: false, error: 'Seu número WhatsApp não está pareado. Configure em Integrações → Ligação via WhatsApp.' };
  }

  // Destino em E.164 (com DDI 55) — o `raw` do lead pode vir sem o 55 conforme a
  // origem (sócio vs lead.telefone), e o WhatsApp só roteia com o código do país.
  const destination = toE164BR(parsed.data.phone);
  if (destination.length < 12) {
    return { success: false, error: 'Número de destino inválido (confira DDD e dígitos).' };
  }

  // Anti-ban (story 7.9): teto de ligações por número numa janela móvel de 24h.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = (await from(supabase, 'calls')
    .select('id')
    .eq('user_id', user.id)
    .eq('type', 'outbound')
    .eq('metadata->>provider', 'whatsapp')
    .gte('started_at', since)
    .limit(DAILY_CALL_LIMIT + 1)) as { data: { id: string }[] | null };
  if ((recent?.length ?? 0) >= DAILY_CALL_LIMIT) {
    return {
      success: false,
      error: `Limite de ${DAILY_CALL_LIMIT} ligações WhatsApp por número em 24h atingido. Aguarde para retomar.`,
    };
  }

  try {
    // Gravação sempre ON (decisão de produto) — o lead é informado no início da
    // chamada. Texto/retenção LGPD: ver RECORDING_CONSENT_NOTICE (a validar c/ jurídico).
    const { callId } = await startVoiceCall(session.service_session_id, destination, true);
    return { success: true, data: { sid: session.service_session_id, callId } };
  } catch (err) {
    return mapVoiceError(err);
  }
}

/**
 * Proxy da troca de SDP (story 7.5/7.1): o browser cria a offer e a manda por
 * aqui; injetamos a API key e devolvemos a answer do serviço. A mídia (áudio)
 * flui direto browser ↔ serviço; só a sinalização passa pelo servidor.
 */
export async function exchangeCallSdp(
  input: z.infer<typeof sdpSchema>,
): Promise<ActionResult<{ sdpAnswer: string }>> {
  const parsed = sdpSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados de SDP inválidos' };

  await requireAuth();

  try {
    const sdpAnswer = await exchangeVoiceSdp(parsed.data.sid, parsed.data.callId, parsed.data.sdpOffer);
    if (!sdpAnswer) return { success: false, error: 'Serviço de voz não retornou a resposta SDP' };
    return { success: true, data: { sdpAnswer } };
  } catch (err) {
    return mapVoiceError(err);
  }
}

/** Encerra uma Ligação via WhatsApp em andamento. */
export async function endWhatsAppCall(
  input: z.infer<typeof endSchema>,
): Promise<ActionResult<{ ended: true }>> {
  const parsed = endSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  await requireAuth();

  try {
    await endVoiceCall(parsed.data.sid, parsed.data.callId);
    return { success: true, data: { ended: true } };
  } catch (err) {
    return mapVoiceError(err);
  }
}
