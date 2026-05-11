import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createNotification } from '@/features/notifications/services/notification.service';

export const maxDuration = 60;

const REMINDER_WINDOW_MINUTES = 30;

const CHANNEL_LABELS: Record<string, string> = {
  phone: 'Ligação',
  whatsapp: 'WhatsApp',
  email: 'Email',
  linkedin: 'LinkedIn',
  research: 'Pesquisa',
};

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60 * 1000);

  let activityReminders = 0;
  let meetingReminders = 0;

  try {
    // ── Scheduled Activity Reminders ──────────────────────────
    const { data: pendingActivities } = (await from(supabase, 'scheduled_activities' as never)
      .select('id, org_id, user_id, lead_id, channel, scheduled_at, notes')
      .eq('status', 'pending')
      .is('reminder_sent_at', null)
      .lte('scheduled_at', windowEnd.toISOString())
      .gte('scheduled_at', now.toISOString())) as {
      data: Array<{
        id: string;
        org_id: string;
        user_id: string;
        lead_id: string;
        channel: string;
        scheduled_at: string;
        notes: string | null;
      }> | null;
    };

    if (pendingActivities?.length) {
      // Fetch lead names for notification body
      const leadIds = [...new Set(pendingActivities.map((a) => a.lead_id))];
      const { data: leads } = (await from(supabase, 'leads')
        .select('id, nome_fantasia, razao_social')
        .in('id', leadIds)) as { data: Array<{ id: string; nome_fantasia: string | null; razao_social: string | null }> | null };
      const leadNameMap = new Map((leads ?? []).map((l) => [l.id, l.nome_fantasia ?? l.razao_social ?? 'Lead']));

      for (const activity of pendingActivities) {
        // Claim atomically BEFORE creating the notification. If two cron ticks
        // race (or the previous tick crashed between createNotification and the
        // UPDATE), only the request that successfully flipped reminder_sent_at
        // from NULL to "now" should fire the notification. Earlier ordering
        // (notification first, claim second) produced 3+ duplicate sino entries
        // for the same scheduled_activity_id in production.
        const { data: claimed } = (await from(supabase, 'scheduled_activities' as never)
          .update({ reminder_sent_at: now.toISOString() } as Record<string, unknown>)
          .eq('id', activity.id)
          .is('reminder_sent_at', null)
          .select('id')) as { data: Array<{ id: string }> | null };

        if (!claimed?.length) continue;

        const leadName = leadNameMap.get(activity.lead_id) ?? 'Lead';
        const channelLabel = CHANNEL_LABELS[activity.channel] ?? activity.channel;
        const timeStr = new Date(activity.scheduled_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        await createNotification({
          org_id: activity.org_id,
          user_id: activity.user_id,
          type: 'activity_reminder',
          title: `Atividade em ${REMINDER_WINDOW_MINUTES}min: ${channelLabel}`,
          body: `${leadName} — agendada para ${timeStr}`,
          resource_type: 'lead',
          resource_id: activity.lead_id,
          metadata: { scheduled_activity_id: activity.id, channel: activity.channel },
        });

        activityReminders++;
      }
    }

    // ── Meeting Reminders ─────────────────────────────────────
    // Meetings are stored as interactions with type='meeting_scheduled'
    // and metadata.start_time or message_content containing the datetime
    const { data: upcomingMeetings } = (await from(supabase, 'interactions')
      .select('id, org_id, performed_by, lead_id, message_content, metadata')
      .eq('type', 'meeting_scheduled')
      .gte('created_at', new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())) as {
      data: Array<{
        id: string;
        org_id: string;
        performed_by: string | null;
        lead_id: string;
        message_content: string | null;
        metadata: Record<string, unknown> | null;
      }> | null;
    };

    if (upcomingMeetings?.length) {
      const leadIds = [...new Set(upcomingMeetings.map((m) => m.lead_id))];
      const meetingIds = upcomingMeetings.map((m) => m.id);

      // Chunk large IN(...) clauses to keep each PostgREST URL under the limit.
      // Without this the cron silently misses reminders once meetingIds grows.
      const CHUNK = 100;

      const [leadsResult, ...reminderChunks] = await Promise.all([
        from(supabase, 'leads')
          .select('id, nome_fantasia, razao_social')
          .in('id', leadIds.slice(0, CHUNK)) as Promise<{ data: Array<{ id: string; nome_fantasia: string | null; razao_social: string | null }> | null }>,
        ...Array.from({ length: Math.ceil(meetingIds.length / CHUNK) }, (_, i) =>
          from(supabase, 'notifications')
            .select('metadata')
            .eq('type', 'meeting_reminder')
            .in('metadata->>interaction_id', meetingIds.slice(i * CHUNK, (i + 1) * CHUNK)) as Promise<{ data: Array<{ metadata: Record<string, unknown> }> | null }>,
        ),
      ]);

      // Fetch remaining lead-name chunks (rare path — kept simple, sequential)
      const leadNameMap = new Map((leadsResult.data ?? []).map((l) => [l.id, l.nome_fantasia ?? l.razao_social ?? 'Lead']));
      for (let i = CHUNK; i < leadIds.length; i += CHUNK) {
        const { data } = (await from(supabase, 'leads')
          .select('id, nome_fantasia, razao_social')
          .in('id', leadIds.slice(i, i + CHUNK))) as { data: Array<{ id: string; nome_fantasia: string | null; razao_social: string | null }> | null };
        for (const l of data ?? []) leadNameMap.set(l.id, l.nome_fantasia ?? l.razao_social ?? 'Lead');
      }

      const sentMeetingIds = new Set(
        reminderChunks.flatMap((r) => (r.data ?? []).map((n) => n.metadata?.interaction_id as string)),
      );

      for (const meeting of upcomingMeetings) {
        if (!meeting.performed_by || !meeting.metadata) continue;
        if (sentMeetingIds.has(meeting.id)) continue;

        const meetLink = meeting.metadata.meet_link as string | undefined;
        const subject = meeting.metadata.subject as string | undefined;

        const timeMatch = meeting.message_content?.match(/Horário:\s*(\d{2}\/\d{2}\/\d{4}),?\s*(\d{2}:\d{2})/);
        if (!timeMatch) continue;

        const [, dateStr, timeStr] = timeMatch;
        const [day, month, year] = dateStr!.split('/');
        const meetingStart = new Date(`${year}-${month}-${day}T${timeStr}:00`);

        if (meetingStart <= now || meetingStart > windowEnd) continue;

        const leadName = leadNameMap.get(meeting.lead_id) ?? 'Lead';

        await createNotification({
          org_id: meeting.org_id,
          user_id: meeting.performed_by,
          type: 'meeting_reminder',
          title: `Reunião em ${REMINDER_WINDOW_MINUTES}min: ${leadName}`,
          body: subject ?? `Reunião agendada para ${timeStr}${meetLink ? ' — Google Meet disponível' : ''}`,
          resource_type: 'lead',
          resource_id: meeting.lead_id,
          metadata: { interaction_id: meeting.id, meet_link: meetLink ?? null },
        });

        meetingReminders++;
      }
    }
  } catch (err) {
    console.error('[activity-reminders] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    activityReminders,
    meetingReminders,
  });
}
