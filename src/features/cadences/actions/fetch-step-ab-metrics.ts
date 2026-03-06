'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { StepAbMetrics } from '../cadences.contract';

export async function fetchStepAbMetrics(
  stepId: string,
): Promise<ActionResult<StepAbMetrics>> {
  await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: rows, error } = (await (supabase
    .from('interactions') as ReturnType<typeof supabase.from>)
    .select('type, metadata')
    .eq('step_id', stepId)
    .in('type', ['sent', 'opened', 'replied', 'bounced'])) as {
    data: Array<{ type: string; metadata: Record<string, unknown> | null }> | null;
    error: { message: string } | null;
  };

  if (error) {
    return { success: false, error: 'Erro ao buscar métricas A/B' };
  }

  const metrics: StepAbMetrics = {
    stepId,
    variant_a: { sent: 0, opened: 0, replied: 0, bounced: 0 },
    variant_b: { sent: 0, opened: 0, replied: 0, bounced: 0 },
  };

  for (const row of rows ?? []) {
    const variant = row.metadata?.ab_variant;
    const bucket = variant === 'B' ? metrics.variant_b : metrics.variant_a;
    const type = row.type as 'sent' | 'opened' | 'replied' | 'bounced';
    if (type in bucket) {
      bucket[type]++;
    }
  }

  return { success: true, data: metrics };
}
