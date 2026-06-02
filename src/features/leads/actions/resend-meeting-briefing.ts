'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { sendMeetingBriefingEmail } from './send-meeting-briefing';

const inputSchema = z.object({
  leadId: z.string().uuid('Lead inválido'),
});

/**
 * Re-send the meeting briefing email to the lead's CURRENT closer, rebuilding
 * the meeting details from the latest meeting_scheduled interaction. Used after
 * a closer reassignment when the meeting hasn't happened yet, so the new closer
 * gets the full lead dossier they'll need.
 */
export async function resendMeetingBriefing(
  input: z.infer<typeof inputSchema>,
): Promise<ActionResult<void>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida' };
  }
  const { leadId } = parsed.data;

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { data: lead } = (await from(supabase, 'leads')
    .select('closer_id')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .maybeSingle()) as { data: { closer_id: string | null } | null };
  if (!lead) {
    return { success: false, error: 'Lead não encontrado' };
  }
  if (!lead.closer_id) {
    return { success: false, error: 'Lead não possui closer atribuído' };
  }

  const { data: meeting } = (await from(supabase, 'interactions')
    .select('metadata')
    .eq('lead_id', leadId)
    .eq('type', 'meeting_scheduled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { metadata: Record<string, unknown> | null } | null };

  const md = meeting?.metadata;
  const startTime = md?.start_time as string | undefined;
  if (!startTime) {
    return { success: false, error: 'Nenhuma reunião agendada encontrada para este lead' };
  }

  const svc = createServiceRoleClient();
  await sendMeetingBriefingEmail(svc, {
    leadId,
    orgId,
    closerId: lead.closer_id,
    sdrUserId: userId,
    meetingTitle: (md?.subject as string | undefined) ?? 'Reunião agendada',
    meetingStart: startTime,
    meetingEnd: (md?.end_time as string | undefined) ?? startTime,
    meetLink: (md?.meet_link as string | undefined) ?? null,
  });

  return { success: true, data: undefined };
}
