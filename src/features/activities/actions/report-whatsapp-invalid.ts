'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

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
  //    WhatsApp steps in the cadence. If no non-WhatsApp steps remain, complete.
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
    await from(supabase, 'cadence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', enrollmentId);
  }

  revalidatePath('/atividades');

  return { success: true, data: undefined };
}
