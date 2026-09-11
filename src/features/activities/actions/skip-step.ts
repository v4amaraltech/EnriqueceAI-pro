'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { createNotification } from '@/features/notifications/services/notification.service';
import { logLeadEvent } from '@/features/leads/actions/log-lead-event';
import { markLeadLostOnCadenceEnd } from '@/features/cadences/services/cadence-end-loss.service';

import { SKIP_NOTE_MAX, SKIP_REASON_VALUES, reasonLabel } from '../constants/skip-reasons';

import { reportWhatsAppInvalid } from './report-whatsapp-invalid';

const skipStepSchema = z.object({
  enrollmentId: z.string().uuid('ID inválido'),
  stepId: z.string().uuid('ID inválido'),
  // Motivo de 1 clique é OBRIGATÓRIO: sem ele o gestor não consegue agrupar
  // por que os passos estão sendo pulados.
  reason: z.enum(SKIP_REASON_VALUES, { message: 'Escolha um motivo' }),
  note: z.string().trim().max(SKIP_NOTE_MAX).optional(),
});

export type SkipStepInput = z.infer<typeof skipStepSchema>;

/**
 * "Pular este passo" — avança o enrollment para o PRÓXIMO step sem encerrar
 * a cadência. É o meio-termo entre "adiar o mesmo step" (`skipActivity`, só
 * empurra `next_step_due`) e "encerrar tudo" (o antigo "Encerrar cadência",
 * que jogava o lead no limbo).
 *
 * Exige motivo. Se o motivo for "contato inválido" num passo de WhatsApp,
 * desvia para o fluxo de WhatsApp inválido (marca o lead e pula TODOS os
 * passos de WhatsApp restantes) — senão a mesma pergunta voltaria 3 passos
 * depois.
 *
 * Reusa a RPC atômica `advance_enrollment_after_step` (a mesma do fluxo de
 * execução em `execute-activity.ts`), passando o step atual como executado —
 * row-locked e idempotente, então duplo clique / retry não regride nem duplica.
 */
export async function skipStep(
  input: SkipStepInput,
): Promise<ActionResult<void>> {
  const parsed = skipStepSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }
  const { enrollmentId, stepId, reason, note } = parsed.data;

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase, userId } = auth.data;

  // Contexto do enrollment para carimbar a timeline antes de avançar — sem esse
  // rastro o SDR não sabe por que o passo foi pulado.
  const { data: enrollment } = (await from(supabase, 'cadence_enrollments')
    .select('lead_id, cadence_id, org_id, current_step')
    .eq('id', enrollmentId)
    .maybeSingle()) as {
      data: { lead_id: string; cadence_id: string; org_id: string; current_step: number } | null;
    };

  if (!enrollment) return { success: false, error: 'Inscrição não encontrada' };

  const { data: step } = (await from(supabase, 'cadence_steps')
    .select('channel')
    .eq('id', stepId)
    .maybeSingle()) as { data: { channel: string } | null };

  const label = reasonLabel(reason);
  const noteSuffix = note ? ` | Obs: ${note}` : '';

  await from(supabase, 'interactions').insert({
    org_id: enrollment.org_id,
    lead_id: enrollment.lead_id,
    cadence_id: enrollment.cadence_id,
    channel: 'system',
    type: 'sent',
    message_content: `Passo pulado pelo SDR — motivo: ${label}${noteSuffix}`,
    performed_by: userId,
    metadata: {
      system_event: 'step_skipped_manual',
      step_at_skip: enrollment.current_step,
      skip_reason: reason,
      skip_note: note ?? null,
    },
  } as Record<string, unknown>);

  // Contato inválido em passo de WhatsApp → fluxo dedicado (marca
  // whatsapp_invalid_at + pula os WhatsApp restantes). Reusa o input que o
  // enrollment já nos deu, sem query extra.
  if (reason === 'invalid_contact' && step?.channel === 'whatsapp') {
    return reportWhatsAppInvalid({
      enrollmentId,
      cadenceId: enrollment.cadence_id,
      stepId,
      leadId: enrollment.lead_id,
      orgId: enrollment.org_id,
    });
  }

  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: Array<{ advanced: boolean; completed: boolean; new_step: number | null }> | null;
    error: { message: string } | null;
  }>)('advance_enrollment_after_step', {
    p_enrollment_id: enrollmentId,
    p_executed_step_id: stepId,
    p_performed_by: userId,
  });

  if (error) {
    console.error('[skip-step] advance_enrollment_after_step falhou:', error.message);
    return { success: false, error: 'Erro ao pular atividade' };
  }

  // Se pular o último step conclui a cadência, avisa o SDR (paridade com o
  // fluxo de execução — evita "sumiço" silencioso ao concluir).
  if (data?.[0]?.completed) {
    // Rastro na timeline: pular o último passo concluiu a cadência.
    await logLeadEvent(supabase, {
      orgId: enrollment.org_id,
      leadId: enrollment.lead_id,
      userId,
      event: 'cadence_completed',
      message: 'Cadência concluída — último passo pulado pelo SDR',
      metadata: { cadence_id: enrollment.cadence_id, enrollment_id: enrollmentId },
    });

    // Fim da cadência sem resposta → Perdido "Nunca respondeu" na hora.
    await markLeadLostOnCadenceEnd({
      orgId: enrollment.org_id,
      leadId: enrollment.lead_id,
      cadenceId: enrollment.cadence_id,
      enrollmentId,
    });

    createNotification({
      org_id: enrollment.org_id,
      user_id: userId,
      type: 'cadence_completed',
      title: 'Cadência concluída',
      body: `Todos os steps foram executados para ${enrollment.lead_id.slice(0, 8)}`,
      resource_type: 'lead',
      resource_id: enrollment.lead_id,
    }).catch((err) => console.error('[skip-step] cadence_completed notification failed:', err));
  }

  revalidatePath('/atividades');
  return { success: true, data: undefined };
}
