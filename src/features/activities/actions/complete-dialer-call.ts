'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

import type { CallStatus } from '@/features/calls/types';

export interface CompleteDialerCallInput {
  enrollmentId: string;
  cadenceId: string;
  stepId: string;
  leadId: string;
  phone: string;
  callStatus: string;
  notes: string;
  durationSeconds?: number;
}

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
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { enrollmentId, cadenceId, stepId, leadId, phone, callStatus, notes, durationSeconds } = input;

  // Get user's org
  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organizacao nao encontrada' };
  }

  // 1. Create call record
  const { data: call, error: callError } = (await supabase
    .from('calls')
    .insert({
      org_id: member.org_id,
      user_id: user.id,
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

  if (callError || !call) {
    console.error('[power-dialer] Failed to create call:', callError?.message);
    return { success: false, error: 'Erro ao registrar ligacao' };
  }

  // 2. Create interaction record
  await from(supabase, 'interactions')
    .insert({
      org_id: member.org_id,
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
