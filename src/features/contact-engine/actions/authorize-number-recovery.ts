'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import {
  authorizeNumberRecovery,
  readNumberHealthFlag,
  type NumberHealthState,
} from '@/features/contact-engine/services/number-health.service';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

interface InstanceHealthRow {
  id: string;
  org_id: string;
  status: string;
  health_state: NumberHealthState;
  health_pause_reason: string | null;
}

/**
 * Action: autoriza recuperacao de numero pausado pela saude.
 *
 * SOMENTE gestor da mesma organizacao, com flag ligada, estado paused/review
 * e WhatsApp reconectado. Actor e role derivam da sessao validada no servidor;
 * JAMAIS confianca no cliente.
 *
 * Exige justificativa minimo 10 caracteres. Mostra motivo da pausa antes de
 * confirmar. Preserva recuperacao para warming (nao healthy), estagio, tetos,
 * janelas, metricas e historico. Apenas pausa da fila health; pode sair, mas
 * pausa manual e preservada. Reconectar nao recupera sozinho.
 *
 * Grava auditoria permanente e idempotente com ator, horario, justificativa,
 * motivo da pausa, estados anterior/novo, estagio e tetos. Garante consistencia
 * entre recuperacao e auditoria inclusive em concorrencia, repeticao e falhas.
 */
export async function authorizeNumberRecoveryAction(
  instanceId: string,
  note: string,
): Promise<ActionResult<{ state: NumberHealthState }>> {
  // 1. Valida sessao: apenas gestor autenticado.
  try {
    const session = await getManagerOrgId();
    if (!session.orgId || !session.userId) {
      return { success: false, error: 'Sessao invalida', code: 'unauthorized' };
    }

  // 2. Valida justificativa (minimo 10 caracteres).
  if (note.trim().length < 10) {
    return { success: false, error: 'Justificativa deve ter no minimo 10 caracteres', code: 'invalid_input' };
  }

  // 3. Verifica flag por organizacao.
  const flag = await readNumberHealthFlag({ orgId: session.orgId });
  if (flag !== 'on') {
    return { success: false, error: 'Saude por numero desativada', code: 'flag_disabled' };
  }

  // 4. Le instancia e valida propriedade, estado e conexao.
  const db = createServiceRoleClient();
  const instRes = (await from(db, 'whatsapp_instances')
    .select('id, org_id, status, health_state, health_pause_reason')
    .eq('id', instanceId)
    .eq('org_id', session.orgId)
    .limit(1)) as unknown as { data: InstanceHealthRow[] | null; error: { message: string } | null };

  if (instRes.error || !instRes.data?.[0]) {
    return { success: false, error: 'Numero nao encontrado ou nao pertence a sua organizacao', code: 'not_found' };
  }

  const inst = instRes.data[0];

  // 5. Valida estado: somente paused ou review podem ser recuperados.
  if (inst.health_state !== 'paused' && inst.health_state !== 'review') {
    return {
      success: false,
      error: 'Numero nao esta pausado pela saude',
      code: 'not_blocked',
    };
  }

  // 6. Valida conexao: WhatsApp deve estar reconectado.
  if (inst.status !== 'connected') {
    return {
      success: false,
      error: 'Reconecte o WhatsApp antes de recuperar',
      code: 'not_connected',
    };
  }

    // 7. Autoriza recuperacao com auditoria permanente.
    // Actor e role derivam da sessao validada no servidor.
    const result = await authorizeNumberRecovery({
      orgId: session.orgId,
      instanceId,
      actor: {
        userId: session.userId,
        orgId: session.orgId,
        role: 'manager',
      },
      note: note.trim(),
    });

    return result;
  } catch (err) {
    console.error('[authorize-number-recovery] Error:', err);
    return { success: false, error: 'Acesso negado', code: 'forbidden' };
  }
}
