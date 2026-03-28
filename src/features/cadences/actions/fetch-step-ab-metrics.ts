'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { safeRate } from '@/features/statistics/types/shared';

import type { AbVariantRates, StepAbMetrics } from '../cadences.contract';
import { chiSquaredTest } from '../utils/chi-squared';

const stepIdSchema = z.string().uuid('ID inválido');

interface StepRow {
  step_order: number;
  ab_winner_variant: string | null;
  ab_winner_at: string | null;
  ab_enabled_at: string | null;
}

function buildVariantRates(raw: { sent: number; opened: number; replied: number; bounced: number }): AbVariantRates {
  return {
    ...raw,
    openRate: safeRate(raw.opened, raw.sent),
    replyRate: safeRate(raw.replied, raw.sent),
    bounceRate: safeRate(raw.bounced, raw.sent),
  };
}

export async function fetchStepAbMetrics(
  stepId: string,
): Promise<ActionResult<StepAbMetrics>> {
  const parsed = stepIdSchema.safeParse(stepId);
  if (!parsed.success) return { success: false, error: 'ID inválido' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  // Fetch step info for winner and enabled_at
  const { data: step } = (await from(supabase, 'cadence_steps')
    .select('step_order, ab_winner_variant, ab_winner_at, ab_enabled_at')
    .eq('id', stepId)
    .single()) as { data: StepRow | null };

  if (!step) {
    return { success: false, error: 'Step não encontrado' };
  }

  const { data: rows, error } = (await from(supabase, 'interactions')
    .select('type, metadata')
    .eq('step_id', stepId)
    .in('type', ['sent', 'opened', 'replied', 'bounced'])) as {
    data: Array<{ type: string; metadata: Record<string, unknown> | null }> | null;
    error: { message: string } | null;
  };

  if (error) {
    return { success: false, error: 'Erro ao buscar métricas A/B' };
  }

  const rawA = { sent: 0, opened: 0, replied: 0, bounced: 0 };
  const rawB = { sent: 0, opened: 0, replied: 0, bounced: 0 };

  for (const row of rows ?? []) {
    const variant = row.metadata?.ab_variant;
    const bucket = variant === 'B' ? rawB : rawA;
    const type = row.type as 'sent' | 'opened' | 'replied' | 'bounced';
    if (type in bucket) {
      bucket[type]++;
    }
  }

  // Compute rates
  const variant_a = buildVariantRates(rawA);
  const variant_b = buildVariantRates(rawB);

  // Confidence level based on sample size
  const minSent = Math.min(rawA.sent, rawB.sent);
  const confidence: 'low' | 'medium' | 'high' = minSent < 30 ? 'low' : minSent < 50 ? 'medium' : 'high';

  // Chi-squared on reply rate
  const testResult = chiSquaredTest(rawA.replied, rawA.sent, rawB.replied, rawB.sent);
  const pValue = testResult?.pValue ?? null;

  // Can declare winner: 50+ sent per variant AND 7+ days since ab_enabled_at
  const daysSinceEnabled = step.ab_enabled_at
    ? (Date.now() - new Date(step.ab_enabled_at).getTime()) / (1000 * 60 * 60 * 24)
    : 0;
  const canDeclareWinner = minSent >= 50 && daysSinceEnabled >= 7 && step.ab_winner_variant === null;

  return {
    success: true,
    data: {
      stepId,
      stepOrder: step.step_order,
      variant_a,
      variant_b,
      confidence,
      pValue,
      canDeclareWinner,
      winnerVariant: (step.ab_winner_variant as 'A' | 'B' | null) ?? null,
      winnerAt: step.ab_winner_at,
    },
  };
}
