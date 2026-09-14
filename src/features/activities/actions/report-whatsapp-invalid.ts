'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { logLeadEvent } from '@/features/leads/actions/log-lead-event';
import { createNotification } from '@/features/notifications/services/notification.service';

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
  //    WhatsApp steps in the cadence. Se não sobrar passo de outro canal, o
  //    enrollment é PAUSADO — nunca encerrado.
  //
  //    "Não é WhatsApp" é feedback sobre o contato, não decisão de tirar o lead
  //    da régua (AC 5 da story activity-skip-guardrails: "a cadência avança").
  //    Encerrar deixava o lead em "Contatado sem cadência" sem rastro nenhum —
  //    11 leads desde jun/2026, achados no acompanhamento de 14/set. Pausado, o
  //    lead continua na cadência, aparece como pausado e volta a andar quando o
  //    número é corrigido.
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
    const { error: pauseErr } = await from(supabase, 'cadence_enrollments')
      .update({ status: 'paused' } as Record<string, unknown>)
      .eq('id', enrollmentId);

    const pauseQErr = handleQueryError(pauseErr, 'Erro ao pausar a cadência do lead', 'activities');
    if (pauseQErr) return pauseQErr;

    // Rastro + aviso: pausa silenciosa é a origem do limbo de cadência.
    const { data: cadence } = (await from(supabase, 'cadences')
      .select('name')
      .eq('id', cadenceId)
      .maybeSingle()) as { data: { name: string } | null };
    const { data: lead } = (await from(supabase, 'leads')
      .select('assigned_to, nome_fantasia, razao_social')
      .eq('id', leadId)
      .maybeSingle()) as {
        data: { assigned_to: string | null; nome_fantasia: string | null; razao_social: string | null } | null;
      };

    const cadenceName = cadence?.name ?? 'cadência';
    await logLeadEvent(supabase, {
      orgId,
      leadId,
      userId,
      event: 'cadence_paused',
      message: `Cadência ${cadenceName} pausada — lead sem WhatsApp e não há passo de outro canal`,
      metadata: { reason: 'whatsapp_invalid', cadence_id: cadenceId, enrollment_id: enrollmentId, step_id: stepId },
    });

    const displayName = lead?.nome_fantasia ?? lead?.razao_social ?? 'Lead';
    createNotification({
      org_id: orgId,
      user_id: lead?.assigned_to ?? userId,
      type: 'integration_error',
      title: `Cadência pausada — lead sem WhatsApp: ${displayName}`,
      body: `Só restavam passos de WhatsApp em "${cadenceName}". Atualize o telefone do lead para a cadência voltar a andar, ou troque de cadência.`,
      resource_type: 'lead',
      resource_id: leadId,
      metadata: { reason: 'whatsapp_invalid', cadence_id: cadenceId, enrollment_id: enrollmentId },
    }).catch((err) => console.error('[report-whatsapp-invalid] notificação falhou:', err));
  }

  revalidatePath('/atividades');

  return { success: true, data: undefined };
}
