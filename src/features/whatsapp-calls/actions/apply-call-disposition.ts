'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { rescheduleCurrentStep } from '@/features/activities/actions/reschedule-current-step';

import { mapDispositionToAction } from '../disposition';

const dispositionSchema = z.object({
  enrollmentId: z.string().uuid(),
  stepId: z.string().uuid(),
  disposition: z.enum(['significant', 'not_significant', 'no_contact', 'busy', 'not_connected']),
  // Horário do callback (ISO) — obrigatório quando a disposition reagenda.
  callbackAt: z.string().datetime().optional(),
});

export type ApplyCallDispositionInput = z.infer<typeof dispositionSchema>;

export type DispositionResult =
  | { action: 'advanced'; advanced: boolean; completed: boolean; newStep: number | null }
  | { action: 'rescheduled'; nextStepDue: string }
  | { action: 'none' };

/**
 * Aplica o desfecho de uma Ligação via WhatsApp à cadência (story 7.6):
 *  - conversa relevante / atendeu  -> avança (advance_enrollment_after_step)
 *  - ocupado / não atendeu         -> reagenda o step atual no `callbackAt`
 *  - não conectou (erro técnico)   -> nada (a atividade volta para a fila)
 *
 * NÃO grava a `calls.status` — a persistência da chamada é da story 7.7. Aqui só
 * a ação de cadência. O avanço é idempotente (RPC com row-lock).
 */
export async function applyCallDisposition(
  input: ApplyCallDispositionInput,
): Promise<ActionResult<DispositionResult>> {
  const parsed = dispositionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };
  const { enrollmentId, stepId, disposition, callbackAt } = parsed.data;

  const action = mapDispositionToAction(disposition);

  if (action === 'none') {
    return { success: true, data: { action: 'none' } };
  }

  if (action === 'reschedule') {
    if (!callbackAt) {
      return { success: false, error: 'Escolha o horário para ligar de novo' };
    }
    const result = await rescheduleCurrentStep({ enrollmentId, nextStepDue: callbackAt });
    if (!result.success) return result;
    return { success: true, data: { action: 'rescheduled', nextStepDue: result.data.nextStepDue } };
  }

  // action === 'advance'
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { userId, supabase } = auth.data;

  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{
      data: Array<{ advanced: boolean; completed: boolean; new_step: number | null }> | null;
      error: { message: string } | null;
    }>
  )('advance_enrollment_after_step', {
    p_enrollment_id: enrollmentId,
    p_executed_step_id: stepId,
    p_performed_by: userId,
  });

  if (error) return { success: false, error: 'Erro ao avançar a cadência' };

  const row = data?.[0];
  return {
    success: true,
    data: {
      action: 'advanced',
      advanced: row?.advanced ?? false,
      completed: row?.completed ?? false,
      newStep: row?.new_step ?? null,
    },
  };
}
