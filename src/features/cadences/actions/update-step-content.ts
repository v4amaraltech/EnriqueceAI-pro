'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

const updateStepContentSchema = z.object({
  stepId: z.string().uuid(),
  cadenceId: z.string().uuid(),
  template_id: z.string().uuid().nullable().optional(),
  ai_personalization: z.boolean().optional(),
  activity_name: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
});

/**
 * Update the content of a single cadence step (template, AI, name, instructions).
 * Allowed even when cadence is active — only content changes, not structure.
 */
export async function updateStepContent(
  input: z.infer<typeof updateStepContentSchema>,
): Promise<ActionResult<void>> {
  const parsed = updateStepContentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Verify cadence belongs to org
  const { data: cadence } = (await from(supabase, 'cadences')
    .select('id, status')
    .eq('id', parsed.data.cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()) as { data: { id: string; status: string } | null };

  if (!cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  // Build update — only include fields that were provided
  const updates: Record<string, unknown> = {};
  if (parsed.data.template_id !== undefined) updates.template_id = parsed.data.template_id;
  if (parsed.data.ai_personalization !== undefined) updates.ai_personalization = parsed.data.ai_personalization;
  if (parsed.data.activity_name !== undefined) updates.activity_name = parsed.data.activity_name;
  if (parsed.data.instructions !== undefined) updates.instructions = parsed.data.instructions;

  if (Object.keys(updates).length === 0) {
    return { success: true, data: undefined };
  }

  const { error } = await from(supabase, 'cadence_steps')
    .update(updates)
    .eq('id', parsed.data.stepId)
    .eq('cadence_id', parsed.data.cadenceId);

  if (error) {
    return { success: false, error: 'Erro ao atualizar step' };
  }

  return { success: true, data: undefined };
}
