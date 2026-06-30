'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { PairingResult } from '../pairing-types';
import {
  VoiceServiceError,
  createVoiceSession,
  deleteVoiceSession,
  getVoiceSession,
} from '../services/voice-service-client';

const sidSchema = z.string().min(1);

function mapVoiceError(err: unknown): { success: false; error: string } {
  if (err instanceof VoiceServiceError) {
    if (err.code === 'not_configured') {
      return { success: false, error: 'Serviço de voz WhatsApp não configurado. Avise o admin.' };
    }
    return { success: false, error: err.message };
  }
  return { success: false, error: 'Erro inesperado no serviço de voz' };
}

/**
 * Resolve a org do usuário logado (membership ativa). Self-service: o "alvo" do
 * pareamento é SEMPRE o próprio usuário — nunca confiamos em userId do cliente.
 */
async function selfOrg(): Promise<{ orgId: string; userId: string } | { error: string }> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();
  const { data: member } = (await from(supabase, 'organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };
  if (!member) return { error: 'Organização não encontrada' };
  return { orgId: member.org_id, userId: user.id };
}

/**
 * Self-service do SDR: cria/reinicia o pareamento do PRÓPRIO número WhatsApp.
 *
 * A RLS de `whatsapp_call_sessions` permite escrita só a managers, então a
 * escrita usa service role — mas o escopo é fixado em código no `org_id` +
 * `user_id` do usuário autenticado, nunca em input do cliente. O usuário só
 * consegue mexer na própria linha. Espelha createPairingSession (manager).
 */
export async function createMyPairingSession(): Promise<ActionResult<PairingResult>> {
  const ctx = await selfOrg();
  if ('error' in ctx) return { success: false, error: ctx.error };
  const { orgId, userId } = ctx;

  const service = createServiceRoleClient();

  // 1 linha por usuário. Limpa a sessão anterior no serviço antes de criar a nova
  // (evita acúmulo e o 400 de "repair" em sessão morta).
  const { data: existing } = (await from(service, 'whatsapp_call_sessions')
    .select('id, service_session_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
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
    voice = await createVoiceSession(userId);
  } catch (err) {
    return mapVoiceError(err);
  }

  if (existing) {
    await from(service, 'whatsapp_call_sessions')
      .update({ service_session_id: voice.sid, status: 'pairing', phone_number: null } as Record<string, unknown>)
      .eq('id', existing.id)
      .eq('user_id', userId);
  } else {
    await from(service, 'whatsapp_call_sessions').insert({
      org_id: orgId,
      user_id: userId,
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
 * Consulta o estado do pareamento do próprio número (polling/confirmação). Só
 * age na sessão cujo `service_session_id` pertence ao usuário autenticado.
 */
export async function getMyPairingStatus(sid: string): Promise<ActionResult<PairingResult>> {
  const ctx = await selfOrg();
  if ('error' in ctx) return { success: false, error: ctx.error };
  const { orgId, userId } = ctx;

  const parsed = sidSchema.safeParse(sid);
  if (!parsed.success) return { success: false, error: 'Sessão inválida' };

  const service = createServiceRoleClient();

  // Confirma que a sessão é DESTE usuário antes de qualquer escrita.
  const { data: own } = (await from(service, 'whatsapp_call_sessions')
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('service_session_id', sid)
    .maybeSingle()) as { data: { id: string } | null };
  if (!own) return { success: false, error: 'Sessão não pertence a você' };

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

  await from(service, 'whatsapp_call_sessions').update(patch).eq('id', own.id).eq('user_id', userId);

  return {
    success: true,
    data: { sid, status: voice.status, qr: voice.qr, phoneNumber: voice.phoneNumber },
  };
}

/**
 * Cancela um pareamento em andamento do próprio número (fechou o diálogo sem
 * parear). Remove a sessão do serviço e a linha local, se ainda não conectada.
 */
export async function cancelMyPairingSession(
  sid: string,
): Promise<ActionResult<{ canceled: true }>> {
  const ctx = await selfOrg();
  if ('error' in ctx) return { success: false, error: ctx.error };
  const { orgId, userId } = ctx;

  const parsed = sidSchema.safeParse(sid);
  if (!parsed.success) return { success: false, error: 'Sessão inválida' };

  try {
    await deleteVoiceSession(sid);
  } catch {
    // best-effort
  }

  const service = createServiceRoleClient();
  await from(service, 'whatsapp_call_sessions')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('service_session_id', sid)
    .neq('status', 'connected');

  return { success: true, data: { canceled: true } };
}
