'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { updateLead } from './update-lead';

const inputSchema = z.object({
  leadId: z.string().uuid('Lead inválido'),
  newCloserId: z.string().uuid('Closer inválido'),
});

export interface ReassignCloserResult {
  /** Whether the closer actually changed (false when the same closer was picked). */
  changed: boolean;
  /** A pending feedback request existed for the old closer and was repointed. */
  feedbackReassigned: boolean;
  /** The lead's latest scheduled meeting is still in the future (briefing resend is relevant). */
  meetingInFuture: boolean;
  /** Name of the new closer, for UI messaging. */
  closerName: string;
}

/**
 * Manager-only: reassign a lead's closer to another person and keep the closer
 * feedback in sync. Covers the recurring case where the closer who booked the
 * meeting (or was set at won) isn't the one who actually ran it.
 *
 * Side effects when the closer changes:
 *  - updates leads.closer_id (audit + timeline via updateLead);
 *  - expires any PENDING feedback request held by the old closer (kills their
 *    link) and creates a fresh pending request for the new closer, so the
 *    notification can be (re)sent to the right person;
 *  - reports whether the latest meeting is still upcoming, so the caller can
 *    decide to resend the briefing.
 *
 * The actual email/WhatsApp dispatch is left to the caller (resendCloserFeedback
 * / resendMeetingBriefing) so the outward-facing send stays explicit.
 */
export async function reassignCloser(
  input: z.infer<typeof inputSchema>,
): Promise<ActionResult<ReassignCloserResult>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida' };
  }
  const { leadId, newCloserId } = parsed.data;

  let orgId: string;
  let supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Acesso restrito a gestores' };
  }

  // New closer must belong to this org and not be deleted.
  const { data: closer } = (await from(supabase, 'closers')
    .select('id, name')
    .eq('id', newCloserId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .maybeSingle()) as { data: { id: string; name: string } | null };
  if (!closer) {
    return { success: false, error: 'Closer não encontrado' };
  }

  const { data: lead } = (await from(supabase, 'leads')
    .select('id, closer_id')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .maybeSingle()) as { data: { id: string; closer_id: string | null } | null };
  if (!lead) {
    return { success: false, error: 'Lead não encontrado' };
  }

  if (lead.closer_id === newCloserId) {
    return {
      success: true,
      data: { changed: false, feedbackReassigned: false, meetingInFuture: false, closerName: closer.name },
    };
  }

  const oldCloserId = lead.closer_id;

  // Persist the closer change (updateLead handles audit log + timeline entry
  // with closer-name resolution + revalidatePath).
  const updateResult = await updateLead(leadId, { closer_id: newCloserId });
  if (!updateResult.success) {
    return updateResult;
  }

  // Feedback bookkeeping runs with the service role: closer_feedback_requests
  // is written by the platform, not the end user.
  const svc = createServiceRoleClient();
  const nowIso = new Date().toISOString();
  let feedbackReassigned = false;

  if (oldCloserId) {
    const { data: pending } = (await from(svc, 'closer_feedback_requests')
      .select('id')
      .eq('lead_id', leadId)
      .eq('closer_id', oldCloserId)
      .is('responded_at', null)
      .gt('expires_at', nowIso)) as { data: Array<{ id: string }> | null };

    if (pending && pending.length > 0) {
      // Kill the old closer's link(s).
      await from(svc, 'closer_feedback_requests')
        .update({ expires_at: nowIso } as Record<string, unknown>)
        .in('id', pending.map((p) => p.id));

      // Create a fresh pending request for the new closer unless one already exists.
      const { data: existingNew } = (await from(svc, 'closer_feedback_requests')
        .select('id')
        .eq('lead_id', leadId)
        .eq('closer_id', newCloserId)
        .is('responded_at', null)
        .gt('expires_at', nowIso)
        .limit(1)
        .maybeSingle()) as { data: { id: string } | null };

      if (!existingNew) {
        await from(svc, 'closer_feedback_requests').insert({
          org_id: orgId,
          lead_id: leadId,
          closer_id: newCloserId,
        } as Record<string, unknown>);
      }
      feedbackReassigned = true;
    }
  }

  // Is the latest scheduled meeting still in the future? (briefing resend hint)
  const { data: meeting } = (await from(svc, 'interactions')
    .select('metadata')
    .eq('lead_id', leadId)
    .eq('type', 'meeting_scheduled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { metadata: Record<string, unknown> | null } | null };
  const startTimeRaw = meeting?.metadata?.start_time as string | undefined;
  const meetingInFuture = startTimeRaw ? new Date(startTimeRaw).getTime() > Date.now() : false;

  return {
    success: true,
    data: { changed: true, feedbackReassigned, meetingInFuture, closerName: closer.name },
  };
}
