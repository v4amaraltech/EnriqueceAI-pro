import { NextResponse } from 'next/server';

import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { sendMeetingBriefingEmail } from '@/features/leads/actions/send-meeting-briefing';

export const maxDuration = 60;

/**
 * Re-send the closer briefing for a previously scheduled meeting.
 *
 * Existed because the original schedule-time briefing got lost when
 * the Next.js Server Action runtime killed the fire-and-forget
 * promise (fixed in 381e43d via `after()`). Useful generally for any
 * meeting whose closer was changed, briefing was missed, or whose
 * lead enriched with BANT data after the original send.
 *
 * Auth: service role bearer. Body: { leadId }.
 */
async function handle(request: Request) {
  if (!verifyServiceRole(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { leadId?: string };
  if (!body.leadId) {
    return NextResponse.json({ error: 'leadId is required' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // Resolve lead + last meeting interaction so we can pass real meeting details.
  const { data: lead } = (await from(supabase, 'leads')
    .select('id, org_id, closer_id, assigned_to')
    .eq('id', body.leadId)
    .single()) as { data: { id: string; org_id: string; closer_id: string | null; assigned_to: string | null } | null };

  if (!lead) return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 });
  if (!lead.closer_id) return NextResponse.json({ error: 'Lead não tem closer atribuído' }, { status: 400 });
  if (!lead.assigned_to) return NextResponse.json({ error: 'Lead não tem SDR atribuído' }, { status: 400 });

  const { data: meeting } = (await from(supabase, 'interactions')
    .select('metadata')
    .eq('lead_id', lead.id)
    .eq('type', 'meeting_scheduled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { metadata: Record<string, unknown> | null } | null };

  if (!meeting?.metadata) {
    return NextResponse.json({ error: 'Nenhuma reunião encontrada para o lead' }, { status: 400 });
  }
  const meta = meeting.metadata as Record<string, string | null>;

  await sendMeetingBriefingEmail(supabase, {
    leadId: lead.id,
    orgId: lead.org_id,
    closerId: lead.closer_id,
    sdrUserId: lead.assigned_to,
    meetingTitle: (meta.subject as string) ?? 'Reunião',
    meetingStart: (meta.start_time as string) ?? new Date().toISOString(),
    meetingEnd: (meta.end_time as string) ?? new Date().toISOString(),
    meetLink: (meta.meet_link as string | null) ?? null,
  });

  return NextResponse.json({ success: true, leadId: lead.id, closerId: lead.closer_id });
}

export const POST = handle;
