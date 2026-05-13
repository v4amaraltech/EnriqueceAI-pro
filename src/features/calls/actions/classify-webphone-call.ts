'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { callStatusSchema } from '../schemas/call.schemas';

// `status` is accepted for backwards compatibility with existing callers
// (PostCallClassificationDialog, ActivityPhonePanel, Api4ComWebphone) but is
// no longer written to the calls table. Single source of truth for call
// status is the API4COM webhook (/api/webhooks/api4com), which classifies
// significant / no_contact / not_connected from hangup_cause + duration.
// The manual SDR input was overwriting the objective measurement with a
// subjective one, producing the divergence the BI team complained about
// in May/2026.
const classifyInputSchema = z.object({
  callId: z.string().uuid(),
  status: callStatusSchema.optional(), // accepted, no longer applied
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

  const { callId, clientDurationSeconds, notes, leadId } = parsed.data;

  // Fetch current call to check ownership and current state
  const { data: call } = (await from(supabase, 'calls')
    .select('id, duration_seconds, lead_id, org_id')
    .eq('id', callId)
    .eq('org_id', orgId)
    .single()) as { data: { id: string; duration_seconds: number; lead_id: string | null; org_id: string } | null };

  if (!call) {
    return { success: false, error: 'Ligação não encontrada' };
  }

  // Status DELIBERATELY omitted — let the API4COM webhook own it.
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (notes) {
    updates.notes = notes;
  }

  // Use client-side duration as fallback if webhook hasn't set it
  if (call.duration_seconds === 0 && clientDurationSeconds > 0) {
    updates.duration_seconds = clientDurationSeconds;
  }

  // Only write if we have a meaningful change (notes or duration); otherwise
  // skip — there's no point flipping updated_at for an empty submission.
  if (Object.keys(updates).length > 1) {
    await from(supabase, 'calls').update(updates).eq('id', callId).eq('org_id', orgId);
  }

  // Create interaction record so the call appears in prospecting stats.
  // The interaction metadata no longer carries callStatus — that lives on
  // calls.status, populated by the webhook.
  const effectiveLeadId = leadId ?? call.lead_id;
  if (effectiveLeadId) {
    await from(supabase, 'interactions')
      .insert({
        org_id: orgId,
        lead_id: effectiveLeadId,
        channel: 'phone',
        type: 'sent',
        message_content: notes || null,
        metadata: { callId, source: 'webphone' },
        performed_by: userId,
      } as Record<string, unknown>);
  }

  return { success: true, data: { callId } };
}
