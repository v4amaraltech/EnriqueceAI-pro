'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { callStatusSchema } from '../schemas/call.schemas';

const classifyInputSchema = z.object({
  callId: z.string().uuid(),
  status: callStatusSchema,
  clientDurationSeconds: z.number().int().min(0),
  notes: z.string().optional(),
  leadId: z.string().uuid().optional(),
});

export async function classifyWebphoneCall(
  input: z.infer<typeof classifyInputSchema>,
): Promise<ActionResult<{ callId: string }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const parsed = classifyInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'Dados inválidos' };
  }

  const { callId, status, clientDurationSeconds, notes, leadId } = parsed.data;

  // Fetch current call to check ownership and current state
  const { data: call } = (await from(supabase, 'calls')
    .select('id, duration_seconds, lead_id, org_id')
    .eq('id', callId)
    .eq('org_id', orgId)
    .single()) as { data: { id: string; duration_seconds: number; lead_id: string | null; org_id: string } | null };

  if (!call) {
    return { success: false, error: 'Chamada não encontrada' };
  }

  // Build update: status + notes, use client duration as fallback
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (notes) {
    updates.notes = notes;
  }

  // Use client-side duration as fallback if webhook hasn't set it
  if (call.duration_seconds === 0 && clientDurationSeconds > 0) {
    updates.duration_seconds = clientDurationSeconds;
  }

  await from(supabase, 'calls').update(updates).eq('id', callId);

  // Create interaction record so the call appears in prospecting stats
  const effectiveLeadId = leadId ?? call.lead_id;
  if (effectiveLeadId) {
    await from(supabase, 'interactions')
      .insert({
        org_id: orgId,
        lead_id: effectiveLeadId,
        channel: 'phone',
        type: 'sent',
        message_content: notes || null,
        metadata: { callId, callStatus: status, source: 'webphone' },
        performed_by: userId,
      } as Record<string, unknown>);
  }

  return { success: true, data: { callId } };
}
