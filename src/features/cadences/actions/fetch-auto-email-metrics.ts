'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

import { safeRate } from '@/lib/utils/format';

import type { AutoEmailCadenceMetrics } from '../cadences.contract';

export async function fetchAutoEmailMetrics(
  cadenceIds: string[],
): Promise<ActionResult<Record<string, AutoEmailCadenceMetrics>>> {
  if (cadenceIds.length === 0) {
    return { success: true, data: {} };
  }

  await requireAuth();
  const supabase = await createServerSupabaseClient();

  // Fetch enrollment counts grouped by cadence_id + status
  const { data: enrollmentRows, error: enrollmentError } = (await from(supabase, 'cadence_enrollments')
    .select('cadence_id, status')
    .in('cadence_id', cadenceIds)) as {
    data: Array<{ cadence_id: string; status: string }> | null;
    error: { message: string } | null;
  };

  if (enrollmentError) {
    return { success: false, error: 'Erro ao buscar métricas de enrollments' };
  }

  // Fetch interaction counts grouped by cadence_id + type
  const { data: interactionRows, error: interactionError } = (await from(supabase, 'interactions')
    .select('cadence_id, type')
    .in('cadence_id', cadenceIds)) as {
    data: Array<{ cadence_id: string; type: string }> | null;
    error: { message: string } | null;
  };

  if (interactionError) {
    return { success: false, error: 'Erro ao buscar métricas de interações' };
  }

  // Aggregate enrollment counts per cadence
  const enrollmentCounts: Record<string, Record<string, number>> = {};
  for (const row of enrollmentRows ?? []) {
    if (!enrollmentCounts[row.cadence_id]) {
      enrollmentCounts[row.cadence_id] = {};
    }
    const bucket = enrollmentCounts[row.cadence_id]!;
    bucket[row.status] = (bucket[row.status] ?? 0) + 1;
  }

  // Aggregate interaction counts per cadence
  const interactionCounts: Record<string, Record<string, number>> = {};
  for (const row of interactionRows ?? []) {
    if (!interactionCounts[row.cadence_id]) {
      interactionCounts[row.cadence_id] = {};
    }
    const bucket = interactionCounts[row.cadence_id]!;
    bucket[row.type] = (bucket[row.type] ?? 0) + 1;
  }

  // Build metrics map
  const metrics: Record<string, AutoEmailCadenceMetrics> = {};

  for (const cadenceId of cadenceIds) {
    const ec = enrollmentCounts[cadenceId] ?? {};
    const ic = interactionCounts[cadenceId] ?? {};

    const sent = ic['sent'] ?? 0;
    const replied = ic['replied'] ?? 0;
    const opened = ic['opened'] ?? 0;

    metrics[cadenceId] = {
      cadenceId,
      active: ec['active'] ?? 0,
      paused: ec['paused'] ?? 0,
      completed: ec['completed'] ?? 0,
      replied: ec['replied'] ?? 0,
      bounced: ec['bounced'] ?? 0,
      sent,
      delivered: ic['delivered'] ?? 0,
      opened,
      failed: ic['failed'] ?? 0,
      meetings: ic['meeting_scheduled'] ?? 0,
      replyRate: safeRate(replied, sent),
      openRate: safeRate(opened, sent),
    };
  }

  return { success: true, data: metrics };
}

