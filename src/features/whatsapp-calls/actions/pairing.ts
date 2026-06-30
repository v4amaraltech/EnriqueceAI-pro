'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { PairingResult } from '../pairing-types';
import { cancelPairingCore, createPairingCore, getPairingStatusCore } from './pairing-core';

const uuidSchema = z.string().uuid();
const sidSchema = z.string().min(1);

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
 * Escreve via client do usuário (RLS permite manager). Ver pairing-core.ts.
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

  return createPairingCore(supabase, org.orgId, targetUserId);
}

/** Consulta o estado do pareamento (polling). Manager-only, org-scoped. */
export async function getPairingStatus(sid: string): Promise<ActionResult<PairingResult>> {
  const org = await managerOrgId();
  if ('error' in org) return { success: false, error: org.error };

  const parsed = sidSchema.safeParse(sid);
  if (!parsed.success) return { success: false, error: 'Sessão inválida' };

  const supabase = await createServerSupabaseClient();
  return getPairingStatusCore(supabase, org.orgId, sid);
}

/** Cancela um pareamento em andamento (diálogo fechado sem parear). Manager-only. */
export async function cancelPairingSession(
  sid: string,
): Promise<ActionResult<{ canceled: true }>> {
  const org = await managerOrgId();
  if ('error' in org) return { success: false, error: org.error };

  const parsed = sidSchema.safeParse(sid);
  if (!parsed.success) return { success: false, error: 'Sessão inválida' };

  const supabase = await createServerSupabaseClient();
  return cancelPairingCore(supabase, org.orgId, sid);
}
