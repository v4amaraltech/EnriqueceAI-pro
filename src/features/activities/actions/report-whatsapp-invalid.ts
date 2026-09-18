'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { logLeadEvent } from '@/features/leads/actions/log-lead-event';
import { createNotification } from '@/features/notifications/services/notification.service';
import { markLeadLostOnCadenceEnd } from '@/features/cadences/services/cadence-end-loss.service';

const inputSchema = z.object({
  enrollmentId: z.string().uuid(),
  cadenceId: z.string().uuid(),
  stepId: z.string().uuid(),
  leadId: z.string().uuid(),
  orgId: z.string().uuid(),
});

export interface ReportWhatsAppInvalidInput {
  enrollmentId: string;
  cadenceId: string;
  stepId: string;
  leadId: string;
  orgId: string;
}

export async function reportWhatsAppInvalid(
  input: ReportWhatsAppInvalidInput,
): Promise<ActionResult<void>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { userId, supabase } = auth.data;

  const { enrollmentId, cadenceId, stepId, leadId, orgId } = input;

  // 1. Flag the lead so future WhatsApp steps are suppressed in the queue.
  const { error: leadErr } = await from(supabase, 'leads')
    .update({ whatsapp_invalid_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', leadId);

  const leadQErr = handleQueryError(leadErr, 'Erro ao marcar lead como sem WhatsApp', 'activities');
  if (leadQErr) return leadQErr;

  // 2. Record the failed interaction for audit/history.
  await from(supabase, 'interactions')
    .insert({
      org_id: orgId,
      lead_id: leadId,
      cadence_id: cadenceId,
      step_id: stepId,
      channel: 'whatsapp',
      type: 'failed',
      metadata: { error: 'not_whatsapp' },
      performed_by: userId,
    } as Record<string, unknown>);

  // 3. Advance the enrollment past the current step, skipping any remaining
  //    WhatsApp steps in the cadence.
  //
  //    "Não é WhatsApp" é feedback sobre o contato, não decisão de tirar o lead
  //    da régua (AC 5 da story activity-skip-guardrails: "a cadência avança").
  //    Antes isso encerrava a inscrição e o lead virava "Contatado sem cadência"
  //    sem rastro nenhum (11 casos desde jun/2026, achados em 14/set).
  //
  //    Quando a cauda da cadência é só WhatsApp não há passo para executar: é
  //    fim de régua, então encerra e passa pela MESMA regra de Perdido do fim
  //    natural (story whatsapp-invalid-tail-ends-cadence, AC 7) — motor e botão
  //    precisam concordar no mesmo cenário.
  const { data: allSteps } = (await from(supabase, 'cadence_steps')
    .select('step_order, channel')
    .eq('cadence_id', cadenceId)
    .order('step_order', { ascending: true })) as {
      data: Array<{ step_order: number; channel: string }> | null;
    };

  const { data: currentStep } = (await from(supabase, 'cadence_steps')
    .select('step_order')
    .eq('id', stepId)
    .single()) as { data: { step_order: number } | null };

  const currentOrder = currentStep?.step_order ?? 0;
  const nextNonWhatsApp = (allSteps ?? []).find(
    (s) => s.step_order > currentOrder && s.channel !== 'whatsapp',
  );

  if (nextNonWhatsApp) {
    await from(supabase, 'cadence_enrollments')
      .update({ current_step: nextNonWhatsApp.step_order } as Record<string, unknown>)
      .eq('id', enrollmentId);
  } else {
    const { error: endErr } = await from(supabase, 'cadence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', enrollmentId)
      .eq('status', 'active');

    const endQErr = handleQueryError(endErr, 'Erro ao encerrar a cadência do lead', 'activities');
    if (endQErr) return endQErr;

    await logLeadEvent(supabase, {
      orgId,
      leadId,
      userId,
      event: 'cadence_completed',
      message: 'Cadência concluída — só restavam passos de WhatsApp e o lead está sem WhatsApp',
      metadata: {
        cadence_id: cadenceId,
        enrollment_id: enrollmentId,
        reason: 'whatsapp_invalid_tail',
        step_id: stepId,
      },
    });

    // Mesma regra do fim natural: "Deixou de responder" na Recovery, "Nunca
    // respondeu" nas outras, com as proteções (respondeu / reunião / outra
    // cadência aberta / retorno agendado).
    const loss = await markLeadLostOnCadenceEnd({ orgId, leadId, cadenceId, enrollmentId });

    const { data: lead } = (await from(supabase, 'leads')
      .select('assigned_to, nome_fantasia, razao_social')
      .eq('id', leadId)
      .maybeSingle()) as {
        data: { assigned_to: string | null; nome_fantasia: string | null; razao_social: string | null } | null;
      };
    const displayName = lead?.nome_fantasia ?? lead?.razao_social ?? 'Lead';

    createNotification({
      org_id: orgId,
      user_id: lead?.assigned_to ?? userId,
      type: 'integration_error',
      title: loss.lost
        ? `Lead perdido — sem WhatsApp e fim da cadência: ${displayName}`
        : `Cadência encerrada — lead sem WhatsApp: ${displayName}`,
      body: loss.lost
        ? `Só restavam passos de WhatsApp. O lead foi marcado como perdido com o motivo "${loss.reasonName}".`
        : 'Só restavam passos de WhatsApp, então a cadência foi encerrada. O lead segue na sua carteira.',
      resource_type: 'lead',
      resource_id: leadId,
      metadata: { reason: 'whatsapp_invalid_tail', cadence_id: cadenceId, enrollment_id: enrollmentId },
    }).catch((err) => console.error('[report-whatsapp-invalid] notificação falhou:', err));
  }

  revalidatePath('/atividades');

  return { success: true, data: undefined };
}
