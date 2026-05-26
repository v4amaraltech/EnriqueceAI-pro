'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

const enrollmentIdSchema = z.string().uuid('ID inválido');

export async function ignoreActivity(
  enrollmentId: string,
): Promise<ActionResult<void>> {
  const parsed = enrollmentIdSchema.safeParse(enrollmentId);
  if (!parsed.success) return { success: false, error: 'ID inválido' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase, userId } = auth.data;

  // Look up enrollment context so we can stamp the timeline before closing
  // the enrollment. Without this audit trail, the lead silently drops out of
  // the cadence: the SDR sees `status=contacted + sem cadência` with no idea
  // why. Guilherme Marx flagged this on 26/05/2026 for lead Studios Gráficos
  // (e93b36c5) — same failure mode the auto-loss path had, different button.
  const { data: enrollment } = (await from(supabase, 'cadence_enrollments')
    .select('lead_id, cadence_id, org_id, current_step')
    .eq('id', enrollmentId)
    .maybeSingle()) as {
      data: { lead_id: string; cadence_id: string; org_id: string; current_step: number } | null;
    };

  if (enrollment) {
    await from(supabase, 'interactions').insert({
      org_id: enrollment.org_id,
      lead_id: enrollment.lead_id,
      cadence_id: enrollment.cadence_id,
      channel: 'system',
      type: 'sent',
      message_content: 'Cadência encerrada manualmente pelo SDR (atividade ignorada)',
      performed_by: userId,
      metadata: {
        system_event: 'cadence_ignored',
        reason: 'manual_ignore',
        step_at_ignore: enrollment.current_step,
      },
    } as Record<string, unknown>);
  }

  const { error } = await from(supabase, 'cadence_enrollments')
    .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', enrollmentId);

  const qErr = handleQueryError(error, 'Erro ao ignorar atividade', 'activities');
  if (qErr) return qErr;

  revalidatePath('/atividades');

  return { success: true, data: undefined };
}
