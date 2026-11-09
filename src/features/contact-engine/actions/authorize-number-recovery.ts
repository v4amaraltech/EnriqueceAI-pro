'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import {
  authorizeNumberRecovery,
  readNumberHealthFlag,
  recoveryIdempotencyToken,
} from '@/features/contact-engine/services/number-health.service';
import type { NumberHealthState } from '@/features/contact-engine/types';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

interface InstanceHealthRow {
  id: string;
  org_id: string;
  status: string;
  health_state: NumberHealthState;
  health_pause_reason: string | null;
  health_state_changed_at: string | null;
}

/**
 * Autoriza recuperacao de numero pausado pela saude.
 *
 * A sessao (getManagerOrgId) define org e usuario. A RPC, em SECURITY DEFINER,
 * volta a exigir gestor ativo dessa org, flag ligada e o episodio lido no banco.
 * O token deriva desses campos: repetir o mesmo pedido repete o token.
 */
export async function authorizeNumberRecoveryAction(
  instanceId: string,
  note: string,
): Promise<ActionResult<{ state: NumberHealthState }>> {
  try {
    const session = await getManagerOrgId();
    if (!session.orgId || !session.userId) {
      return { success: false, error: 'Sessao invalida', code: 'unauthorized' };
    }

    if (note.trim().length < 10) {
      return { success: false, error: 'Justificativa deve ter no minimo 10 caracteres', code: 'invalid_input' };
    }

    const flag = await readNumberHealthFlag({ orgId: session.orgId });
    if (flag !== 'on') {
      return { success: false, error: 'Saude por numero desativada', code: 'flag_disabled' };
    }

    const db = createServiceRoleClient();
    const instRes = (await from(db, 'whatsapp_instances')
      .select('id, org_id, status, health_state, health_pause_reason, health_state_changed_at')
      .eq('id', instanceId)
      .eq('org_id', session.orgId)
      .limit(1)) as unknown as { data: InstanceHealthRow[] | null; error: { message: string } | null };

    if (instRes.error || !instRes.data?.[0]) {
      return { success: false, error: 'Numero nao encontrado ou nao pertence a sua organizacao', code: 'not_found' };
    }

    const inst = instRes.data[0];

    if (inst.health_state !== 'paused' && inst.health_state !== 'review') {
      return {
        success: false,
        error: 'Numero nao esta pausado pela saude',
        code: 'not_blocked',
      };
    }

    if (inst.status !== 'connected') {
      return {
        success: false,
        error: 'Reconecte o WhatsApp antes de recuperar',
        code: 'not_connected',
      };
    }

    if (!inst.health_state_changed_at) {
      return { success: false, error: 'Episodio de pausa sem instante', code: 'episode_unbound' };
    }

    const trimmed = note.trim();
    const idempotencyToken = recoveryIdempotencyToken({
      orgId: session.orgId,
      instanceId,
      actorUserId: session.userId,
      note: trimmed,
      blockedAt: inst.health_state_changed_at,
    });

    return await authorizeNumberRecovery({
      orgId: session.orgId,
      instanceId,
      actor: {
        userId: session.userId,
        orgId: session.orgId,
        role: 'manager',
      },
      note: trimmed,
      idempotencyToken,
      expectedBlockedAt: inst.health_state_changed_at,
    });
  } catch (err) {
    console.error('[authorize-number-recovery] Error:', err);
    return { success: false, error: 'Acesso negado', code: 'forbidden' };
  }
}
