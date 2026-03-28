'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { CallStatus } from '@/features/calls/types';
import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';

const completeDialerCallSchema = z.object({
  enrollmentId: z.string().uuid(),
  cadenceId: z.string().uuid(),
  stepId: z.string().uuid(),
  leadId: z.string().uuid(),
  phone: z.string().min(8),
  callStatus: z.string().min(1),
  notes: z.string(),
  durationSeconds: z.number().int().nonnegative().optional(),
});

export type CompleteDialerCallInput = z.infer<typeof completeDialerCallSchema>;

// Map dialer UI status to calls table status
const statusMap: Record<string, CallStatus> = {
  connected: 'significant',
  gatekeeper: 'significant',
  meeting_scheduled: 'significant',
  voicemail: 'not_connected',
  no_answer: 'no_contact',
  busy: 'busy',
  wrong_number: 'not_connected',
};

export async function completeDialerCall(
  input: CompleteDialerCallInput,
): Promise<ActionResult<{ callId: string }>> {
  const parsed = completeDialerCallSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { enrollmentId, cadenceId, stepId, leadId, phone, callStatus, notes, durationSeconds } = parsed.data;

  // 1. Create call record
  const { data: call, error: callError } = (await from(supabase, 'calls')
    .insert({
      org_id: orgId,
      user_id: userId,
      lead_id: leadId,
      origin: 'power_dialer',
      destination: phone,
      duration_seconds: durationSeconds ?? 0,
      status: statusMap[callStatus] ?? 'not_connected',
      type: 'outbound',
      notes: notes ? `[${callStatus}] ${notes}` : `[${callStatus}]`,
    })
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  const qErr = handleQueryError(callError, 'Erro ao registrar ligação', 'power-dialer');
  if (qErr || !call) return qErr ?? { success: false, error: 'Erro ao registrar ligação' };

  // Dispatch call.completed or call.missed webhook
  const missedStatuses = ['no_answer', 'busy', 'wrong_number'];
  const callWebhookEvent = missedStatuses.includes(callStatus) ? 'call.missed' : 'call.completed';
  dispatchWebhookEvent(supabase, orgId, callWebhookEvent, {
    lead_id: leadId,
    call_id: call.id,
    call_status: callStatus,
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
      metadata: { callStatus, callId: call.id, source: 'power_dialer' },
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
