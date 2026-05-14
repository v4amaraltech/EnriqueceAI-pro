'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';

// callStatus is accepted for backwards compatibility (older UI versions in
// the wild may still send it) but no longer used. Notes go in plain, and
// the outbound webhook is always 'call.completed' — the consumer can read
// the final state off calls.status (populated by the API4COM webhook /
// reconcile cron) instead of relying on the SDR's tag.
const completeDialerCallSchema = z.object({
  enrollmentId: z.string().uuid(),
  cadenceId: z.string().uuid(),
  stepId: z.string().uuid(),
  leadId: z.string().uuid(),
  phone: z.string().min(8),
  callStatus: z.string().optional(),
  notes: z.string(),
  durationSeconds: z.number().int().nonnegative().optional(),
});

export type CompleteDialerCallInput = z.infer<typeof completeDialerCallSchema>;

export async function completeDialerCall(
  input: CompleteDialerCallInput,
): Promise<ActionResult<{ callId: string }>> {
  const parsed = completeDialerCallSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { enrollmentId, cadenceId, stepId, leadId, phone, notes, durationSeconds } = parsed.data;

  // 1. Create call record. `status` omitted on purpose — the calls schema
  // defaults it to 'not_connected' and the API4COM webhook / reconcile cron
  // upgrade it to significant / no_contact / etc when the provider reports.
  const { data: call, error: callError } = (await from(supabase, 'calls')
    .insert({
      org_id: orgId,
      user_id: userId,
      lead_id: leadId,
      origin: 'power_dialer',
      destination: phone,
      duration_seconds: durationSeconds ?? 0,
      type: 'outbound',
      notes: notes || null,
    })
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  const qErr = handleQueryError(callError, 'Erro ao registrar ligação', 'power-dialer');
  if (qErr || !call) return qErr ?? { success: false, error: 'Erro ao registrar ligação' };

  // Always emit call.completed — the granular missed/answered split can be
  // derived downstream from calls.status. Kept the dispatch so existing
  // webhook subscribers stay wired.
  dispatchWebhookEvent(supabase, orgId, 'call.completed', {
    lead_id: leadId,
    call_id: call.id,
    duration_seconds: durationSeconds ?? 0,
  }).catch((err) => console.error('[webhook] call dispatch failed:', err));

  // 2. Create interaction record
  await from(supabase, 'interactions')
    .insert({
      org_id: orgId,
      lead_id: leadId,
      cadence_id: cadenceId,
      step_id: stepId,
      channel: 'phone',
      type: 'sent',
      message_content: notes || null,
      metadata: { callId: call.id, source: 'power_dialer' },
    } as Record<string, unknown>);

  // 3. Advance cadence: find next step
  const { data: currentStepData } = (await from(supabase, 'cadence_steps')
    .select('step_order')
    .eq('id', stepId)
    .single()) as { data: { step_order: number } | null };

  const currentOrder = currentStepData?.step_order ?? 0;

  const { data: nextStep } = (await from(supabase, 'cadence_steps')
    .select('step_order')
    .eq('cadence_id', cadenceId)
    .gt('step_order', currentOrder)
    .order('step_order', { ascending: true })
    .limit(1)
    .maybeSingle()) as { data: { step_order: number } | null };

  if (nextStep) {
    // Only update current_step — the DB trigger calculate_next_step_due
    // automatically sets next_step_due based on the new step's delay
    await from(supabase, 'cadence_enrollments')
      .update({
        current_step: nextStep.step_order,
      } as Record<string, unknown>)
      .eq('id', enrollmentId);
  } else {
    // Last step — mark enrollment as completed
    await from(supabase, 'cadence_enrollments')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', enrollmentId);
  }

  revalidatePath('/atividades');

  return { success: true, data: { callId: call.id } };
}
