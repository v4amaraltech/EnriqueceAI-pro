'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { PairingResult } from '../pairing-types';
import { cancelPairingCore, createPairingCore, getPairingStatusCore } from './pairing-core';

const sidSchema = z.string().min(1);

/**
 * Resolve a org do usuário logado (membership ativa). Self-service: o alvo do
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
 * Self-service: cria/reinicia o pareamento do PRÓPRIO número WhatsApp.
 *
 * A RLS de `whatsapp_call_sessions` permite escrita só a managers, então a
 * escrita usa service role — mas o `pairing-core` recebe o `org_id`+`user_id`
 * do usuário autenticado e escopa tudo neles (nunca em input do cliente).
 */
export async function createMyPairingSession(): Promise<ActionResult<PairingResult>> {
  const ctx = await selfOrg();
  if ('error' in ctx) return { success: false, error: ctx.error };
  return createPairingCore(createServiceRoleClient(), ctx.orgId, ctx.userId);
}

/** Consulta o estado do pareamento do próprio número (escopado por user). */
export async function getMyPairingStatus(sid: string): Promise<ActionResult<PairingResult>> {
  const ctx = await selfOrg();
  if ('error' in ctx) return { success: false, error: ctx.error };

  const parsed = sidSchema.safeParse(sid);
  if (!parsed.success) return { success: false, error: 'Sessão inválida' };

  return getPairingStatusCore(createServiceRoleClient(), ctx.orgId, sid, ctx.userId);
}

/** Cancela um pareamento em andamento do próprio número (escopado por user). */
export async function cancelMyPairingSession(
  sid: string,
): Promise<ActionResult<{ canceled: true }>> {
  const ctx = await selfOrg();
  if ('error' in ctx) return { success: false, error: ctx.error };

  const parsed = sidSchema.safeParse(sid);
  if (!parsed.success) return { success: false, error: 'Sessão inválida' };

  return cancelPairingCore(createServiceRoleClient(), ctx.orgId, sid, ctx.userId);
}
