'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { WhatsAppCallSessionStatus } from '../types';
import {
  VoiceServiceError,
  createVoiceSession,
  getVoiceSession,
  pairVoiceSession,
} from '../services/voice-service-client';

const uuidSchema = z.string().uuid();
const sidSchema = z.string().min(1);

interface PairingResult {
  sid: string;
  status: WhatsAppCallSessionStatus;
  qr: string | null;
  phoneNumber: string | null;
}

function mapVoiceError(err: unknown): { success: false; error: string } {
  if (err instanceof VoiceServiceError) {
    if (err.code === 'not_configured') {
      return { success: false, error: 'Serviço de voz WhatsApp não configurado. Avise o admin.' };
    }
    return { success: false, error: err.message };
  }
  return { success: false, error: 'Erro inesperado no serviço de voz' };
}

async function managerOrgId(): Promise<{ orgId: string } | { error: string }> {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();
  const { data: member } = (await from(supabase, 'organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };
  if (!member) return { error: 'Organização não encontrada' };
  return { orgId: member.org_id };
}

/**
 * Cria/reinicia o pareamento de um número WhatsApp para um SDR. Manager-only.
 * Persiste/atualiza a sessão em `whatsapp_call_sessions` (status='pairing').
 */
export async function createPairingSession(
  targetUserId: string,
): Promise<ActionResult<PairingResult>> {
  const org = await managerOrgId();
  if ('error' in org) return { success: false, error: org.error };

  const parsed = uuidSchema.safeParse(targetUserId);
  if (!parsed.success) return { success: false, error: 'SDR inválido' };

  const supabase = await createServerSupabaseClient();

  // Garante que o alvo é membro ativo da mesma org.
  const { data: target } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('user_id', targetUserId)
    .eq('org_id', org.orgId)
    .eq('status', 'active')
    .single()) as { data: { user_id: string } | null };
  if (!target) return { success: false, error: 'SDR não encontrado nesta organização' };

  let voice;
  try {
    voice = await createVoiceSession(targetUserId);
  } catch (err) {
    return mapVoiceError(err);
  }

  // Upsert manual: 1 linha por SDR (reusa a existente em re-pareamento).
  const { data: existing } = (await from(supabase, 'whatsapp_call_sessions')
    .select('id')
    .eq('org_id', org.orgId)
    .eq('user_id', targetUserId)
    .maybeSingle()) as { data: { id: string } | null };

  if (existing) {
    await from(supabase, 'whatsapp_call_sessions')
      .update({ service_session_id: voice.sid, status: 'pairing', phone_number: null } as Record<string, unknown>)
      .eq('id', existing.id);
  } else {
    await from(supabase, 'whatsapp_call_sessions')
      .insert({
        org_id: org.orgId,
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
 * Consulta o estado do pareamento (polling). Quando conecta, persiste o número
 * e marca a sessão como `connected`. Manager-only.
 */
export async function getPairingStatus(sid: string): Promise<ActionResult<PairingResult>> {
  const org = await managerOrgId();
  if ('error' in org) return { success: false, error: org.error };

  const parsed = sidSchema.safeParse(sid);
  if (!parsed.success) return { success: false, error: 'Sessão inválida' };

  let voice;
  try {
    voice = await getVoiceSession(sid);
  } catch (err) {
    return mapVoiceError(err);
  }
  if (!voice) return { success: false, error: 'Sessão não encontrada no serviço de voz' };

  const supabase = await createServerSupabaseClient();
  const patch: Record<string, unknown> =
    voice.status === 'connected'
      ? { status: 'connected', phone_number: voice.phoneNumber, paired_at: new Date().toISOString() }
      : { status: voice.status };

  await from(supabase, 'whatsapp_call_sessions')
    .update(patch)
    .eq('org_id', org.orgId)
    .eq('service_session_id', sid);

  return {
    success: true,
    data: { sid, status: voice.status, qr: voice.qr, phoneNumber: voice.phoneNumber },
  };
}

/** Gera novo QR para re-parear uma sessão morta. Manager-only. */
export async function repairSession(sid: string): Promise<ActionResult<PairingResult>> {
  const org = await managerOrgId();
  if ('error' in org) return { success: false, error: org.error };

  const parsed = sidSchema.safeParse(sid);
  if (!parsed.success) return { success: false, error: 'Sessão inválida' };

  let voice;
  try {
    voice = await pairVoiceSession(sid);
  } catch (err) {
    return mapVoiceError(err);
  }

  const supabase = await createServerSupabaseClient();
  await from(supabase, 'whatsapp_call_sessions')
    .update({ status: 'pairing', phone_number: null } as Record<string, unknown>)
    .eq('org_id', org.orgId)
    .eq('service_session_id', sid);

  return {
    success: true,
    data: { sid, status: voice.status, qr: voice.qr, phoneNumber: voice.phoneNumber },
  };
}
