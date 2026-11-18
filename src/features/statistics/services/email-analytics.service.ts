import type { SupabaseClient } from '@supabase/supabase-js';

import { chunkedIn } from '@/lib/supabase/chunked-in';
import { from } from '@/lib/supabase/from';
import { isUuid } from '@/lib/utils/uuid';
import { formatDateLabel } from '@/lib/utils/format';
import { INTERACTION_TYPE_COLORS } from '@/shared/constants/chart-colors';

import type { FunnelStage } from '../types/conversion-analytics.types';
import type {
  DailyBounceTrendEntry,
  DailyEmailTrendEntry,
  EmailAnalyticsData,
} from '../types/email-analytics.types';
import { safeRate } from '../types/shared';
import { type EmailStatsRow, isProspectingEmailRow } from './email-scope';
import { readAllRows } from './read-all-rows';

export async function fetchEmailAnalyticsData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
  cadenceId?: string,
): Promise<EmailAnalyticsData> {
  // When filtering by userIds, get lead_ids enrolled by those users
  let leadIdFilter: string[] | undefined;
  if (userIds && userIds.length > 0) {
    // cadence_enrollments has no org_id column — scope via org cadences
    const { data: orgCadences } = (await from(supabase, 'cadences')
      .select('id')
      .eq('org_id', orgId)
      .is('deleted_at', null)) as { data: { id: string }[] | null };
    const cadenceIds = (orgCadences ?? []).map((c) => c.id);
    if (cadenceIds.length === 0) return emptyData();

    const { data: enrollments } = (await from(supabase, 'cadence_enrollments')
      .select('lead_id')
      .in('cadence_id', cadenceIds)
      .in('enrolled_by', userIds)) as { data: { lead_id: string }[] | null };
    leadIdFilter = (enrollments ?? []).map((e) => e.lead_id);
    if (leadIdFilter.length === 0) {
      return emptyData();
    }
  }

  // Paginado (antes `.limit(10000)`, que cortava em silêncio — set/2026).
  // Lembretes de reunião e feedback do closer não têm cadência: o filtro de
  // cadence_id já os corta no banco; o resto da regra fica em email-scope.ts.
  const buildBaseQuery = (leadChunk?: string[]) => {
    let q = from(supabase, 'interactions')
      .select(
        'type, lead_id, cadence_id, created_at, external_id, manual_send:metadata->>manual_send, meeting_reminder:metadata->>meeting_reminder, source:metadata->>source',
      )
      .eq('org_id', orgId)
      .eq('channel', 'email')
      .not('cadence_id', 'is', null)
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd);
    if (isUuid(cadenceId)) q = q.eq('cadence_id', cadenceId);
    if (leadChunk) q = q.in('lead_id', leadChunk);
    return q.order('created_at', { ascending: true }).order('id', { ascending: true });
  };

  let rows: EmailStatsRow[];
  if (leadIdFilter && leadIdFilter.length > 0) {
    rows = await chunkedIn<EmailStatsRow>(leadIdFilter, async (chunk) => ({
      data: await readAllRows<EmailStatsRow>('e-mail: interações', () => buildBaseQuery(chunk)),
      error: null,
    }));
  } else {
    rows = await readAllRows<EmailStatsRow>('e-mail: interações', () => buildBaseQuery());
  }

  return calculateEmailAnalytics(rows);
}

/**
 * Lead → date (YYYY-MM-DD) of its first event of `type`, only for leads that
 * received a prospecting e-mail in the period. Bounce/reply rows don't carry
 * the sender's `source`, so an Ana IA e-mail's bounce would otherwise leak in.
 * Rows come sorted by created_at.
 */
function firstEventByLead(rows: EmailStatsRow[], type: string, emailed: Set<string>): Map<string, string> {
  const first = new Map<string, string>();
  for (const row of rows) {
    if (row.type !== type || first.has(row.lead_id) || !emailed.has(row.lead_id)) continue;
    first.set(row.lead_id, row.created_at.slice(0, 10));
  }
  return first;
}

/**
 * Prospecting e-mail metrics. `totalSent` counts e-mails (volume); everything
 * else counts distinct leads, so a lead whose reply was recorded 12 times
 * (old thread re-checks) counts once.
 */
export function calculateEmailAnalytics(allRows: EmailStatsRow[]): EmailAnalyticsData {
  const rows = [...allRows].filter(isProspectingEmailRow).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const sentRows = rows.filter((r) => r.type === 'sent');
  if (sentRows.length === 0) return emptyData();

  const totalSent = sentRows.length;
  const emailed = new Set(sentRows.map((r) => r.lead_id));
  const emailedLeads = emailed.size;

  const firstOpened = firstEventByLead(rows, 'opened', emailed);
  const firstClicked = firstEventByLead(rows, 'clicked', emailed);
  const firstReplied = firstEventByLead(rows, 'replied', emailed);
  const firstBounced = firstEventByLead(rows, 'bounced', emailed);

  const totalOpened = firstOpened.size;
  const totalClicked = firstClicked.size;
  const totalReplied = firstReplied.size;
  const totalBounced = firstBounced.size;
  // Gmail não confirma entrega: entregue = recebeu e-mail e não deu bounce.
  const totalDelivered = Math.max(0, emailedLeads - totalBounced);

  return {
    totalSent,
    emailedLeads,
    totalDelivered,
    totalOpened,
    totalClicked,
    totalReplied,
    totalBounced,
    openRate: safeRate(totalOpened, emailedLeads),
    clickRate: safeRate(totalClicked, emailedLeads),
    replyRate: safeRate(totalReplied, emailedLeads),
    bounceRate: safeRate(totalBounced, emailedLeads),
    funnel: buildFunnel(emailedLeads, totalDelivered, totalOpened, totalClicked, totalReplied),
    dailyTrend: buildDailyTrend(sentRows, firstOpened, firstReplied),
    bounceTrend: buildBounceTrend(firstBounced),
  };
}

function buildFunnel(
  emailed: number,
  delivered: number,
  opened: number,
  clicked: number,
  replied: number,
): FunnelStage[] {
  return [
    { label: 'Receberam e-mail', count: emailed, percentage: 100, color: INTERACTION_TYPE_COLORS.sent! },
    { label: 'Entregues', count: delivered, percentage: safeRate(delivered, emailed), color: INTERACTION_TYPE_COLORS.delivered! },
    { label: 'Abriram', count: opened, percentage: safeRate(opened, emailed), color: INTERACTION_TYPE_COLORS.opened! },
    { label: 'Clicaram', count: clicked, percentage: safeRate(clicked, emailed), color: INTERACTION_TYPE_COLORS.clicked! },
    { label: 'Responderam', count: replied, percentage: safeRate(replied, emailed), color: INTERACTION_TYPE_COLORS.replied! },
  ];
}

function buildDailyTrend(
  sentRows: EmailStatsRow[],
  firstOpened: Map<string, string>,
  firstReplied: Map<string, string>,
): DailyEmailTrendEntry[] {
  const dayMap = new Map<string, { sent: number; opened: number; replied: number }>();
  const bump = (date: string, key: 'sent' | 'opened' | 'replied') => {
    const entry = dayMap.get(date) ?? { sent: 0, opened: 0, replied: 0 };
    entry[key]++;
    dayMap.set(date, entry);
  };

  for (const row of sentRows) bump(row.created_at.slice(0, 10), 'sent');
  for (const date of firstOpened.values()) bump(date, 'opened');
  for (const date of firstReplied.values()) bump(date, 'replied');

  return Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({
      date,
      label: formatDateLabel(date),
      ...counts,
    }));
}

function buildBounceTrend(firstBounced: Map<string, string>): DailyBounceTrendEntry[] {
  const dayMap = new Map<string, number>();
  for (const date of firstBounced.values()) dayMap.set(date, (dayMap.get(date) ?? 0) + 1);

  return Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bounced]) => ({
      date,
      label: formatDateLabel(date),
      bounced,
    }));
}

function emptyData(): EmailAnalyticsData {
  return {
    totalSent: 0,
    emailedLeads: 0,
    totalDelivered: 0,
    totalOpened: 0,
    totalClicked: 0,
    totalReplied: 0,
    totalBounced: 0,
    openRate: 0,
    clickRate: 0,
    replyRate: 0,
    bounceRate: 0,
    funnel: [],
    dailyTrend: [],
    bounceTrend: [],
  };
}
