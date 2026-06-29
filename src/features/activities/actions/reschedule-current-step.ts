'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { logLeadEvent } from '@/features/leads/actions/log-lead-event';

const rescheduleSchema = z.object({
  enrollmentId: z.string().uuid('ID inválido'),
  // Horário escolhido pelo SDR para o callback (ISO, no futuro).
  nextStepDue: z.string().datetime({ message: 'Data inválida' }),
  reason: z.string().max(280).optional(),
});

export type RescheduleCurrentStepInput = z.infer<typeof rescheduleSchema>;

/**
 * Reagenda o STEP ATUAL de um enrollment para um horário escolhido (callback),
 * mantendo `current_step` e `status='active'` — NÃO avança a cadência. É o
 * "ligar de novo às X" do disposition de Ligação via WhatsApp (story 7.6).
 *
 * Difere do `skipActivity` (snooze fixo) por aceitar o horário exato do SDR.
 */
export async function rescheduleCurrentStep(
  input: RescheduleCurrentStepInput,
): Promise<ActionResult<{ nextStepDue: string }>> {
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }
  const { enrollmentId, nextStepDue, reason } = parsed.data;

  if (new Date(nextStepDue).getTime() <= Date.now()) {
    return { success: false, error: 'O horário do retorno deve ser no futuro' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { data: enrollment } = (await from(supabase, 'cadence_enrollments')
    .select('cadence_id, current_step, lead_id, status')
    .eq('id', enrollmentId)
    .single()) as {
    data: { cadence_id: string; current_step: number; lead_id: string; status: string } | null;
  };

  if (!enrollment) return { success: false, error: 'Enrollment não encontrado' };
  if (enrollment.status !== 'active') {
    return { success: false, error: 'A cadência não está ativa' };
  }

  const { error } = await from(supabase, 'cadence_enrollments')
    .update({ next_step_due: nextStepDue } as Record<string, unknown>)
    .eq('id', enrollmentId);

  const qErr = handleQueryError(error, 'Erro ao reagendar atividade', 'activities');
  if (qErr) return qErr;

  if (enrollment.lead_id) {
    await logLeadEvent(supabase, {
      orgId,
      leadId: enrollment.lead_id,
      userId,
      event: 'step_rescheduled',
      message: `Retorno reagendado${reason ? ` — ${reason}` : ''}`,
      metadata: { cadence_id: enrollment.cadence_id, next_step_due: nextStepDue },
    });
  }

  revalidatePath('/atividades');

  return { success: true, data: { nextStepDue } };
}
