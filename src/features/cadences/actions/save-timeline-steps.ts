'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

import type { ChannelType } from '../types';

export interface TimelineStepInput {
  channel: ChannelType;
  delay_days: number;
  delay_hours?: number;
  step_order: number;
  template_id?: string | null;
  ai_personalization?: boolean;
  activity_name?: string | null;
  instructions?: string | null;
}

export async function saveTimelineSteps(
  cadenceId: string,
  steps: TimelineStepInput[],
): Promise<ActionResult<{ saved: number }>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  // Verify org
  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  // Verify cadence belongs to org and is editable
  const { data: cadence } = (await from(supabase, 'cadences')
    .select('id, status')
    .eq('id', cadenceId)
    .eq('org_id', member.org_id)
    .is('deleted_at', null)
    .single()) as { data: { id: string; status: string } | null };

  if (!cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  if (cadence.status !== 'draft' && cadence.status !== 'paused') {
    return { success: false, error: 'Cadência precisa estar em rascunho ou pausada para editar passos' };
  }

  // Delete existing steps
  const { error: deleteError } = await from(supabase, 'cadence_steps')
    .delete()
    .eq('cadence_id', cadenceId);

  if (deleteError) {
    return { success: false, error: 'Erro ao limpar passos existentes' };
  }

  // Insert new steps
  if (steps.length > 0) {
    const rows = steps.map((s) => ({
      cadence_id: cadenceId,
      step_order: s.step_order,
      channel: s.channel,
      delay_days: s.delay_days,
      delay_hours: s.delay_hours ?? 0,
      template_id: s.template_id ?? null,
      ai_personalization: s.ai_personalization ?? false,
      activity_name: s.activity_name ?? null,
      instructions: s.instructions ?? null,
    }));

    const { error: insertError } = await from(supabase, 'cadence_steps')
      .insert(rows as Record<string, unknown>[]);

    if (insertError) {
      return { success: false, error: 'Erro ao salvar passos' };
    }
  }

  // Update total_steps
  await from(supabase, 'cadences')
    .update({ total_steps: steps.length } as Record<string, unknown>)
    .eq('id', cadenceId);

  return { success: true, data: { saved: steps.length } };
}
