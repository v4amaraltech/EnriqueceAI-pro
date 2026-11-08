'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { recordHumanCorrection } from '@/features/contact-engine/services/call-priority.service';

const inputSchema = z.object({
  leadId: z.string().uuid(),
  /** Interesse de 0 (nenhum) a 100 (máximo), definido por uma pessoa. */
  interest: z.number().min(0).max(100),
  /** Chave gerada pelo cliente por intenção de correção; repetir não grava de novo. */
  requestId: z.string().min(1).max(100),
});

/**
 * Correção humana do interesse do lead no score de prioridade v2 (PR11). A
 * correção prevalece sobre o cálculo e fica registrada em `decision_events` com
 * o autor. Com `call_priority_v2` desligada não faz nada.
 */
export async function correctCallPriorityAction(input: unknown): Promise<ActionResult<{ interest: number; duplicate: boolean }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, role } = auth.data;

  const result = await recordHumanCorrection({
    actor: { orgId, userId, isManager: role === 'manager' },
    leadId: parsed.data.leadId,
    interest: parsed.data.interest,
    requestId: parsed.data.requestId,
  });
  switch (result.status) {
    case 'recorded':
    case 'duplicate':
      return { success: true, data: { interest: result.interest, duplicate: result.status === 'duplicate' } };
    case 'disabled':
      return { success: false, error: 'Prioridade v2 desligada', code: 'flag_disabled' };
    case 'not_found':
      return { success: false, error: 'Lead não encontrado' };
    case 'invalid':
      return { success: false, error: 'Dados inválidos' };
    default:
      return { success: false, error: 'Falha ao registrar a correção' };
  }
}
