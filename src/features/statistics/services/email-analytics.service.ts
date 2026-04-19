import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { formatDateLabel } from '@/lib/utils/format';
import { INTERACTION_TYPE_COLORS } from '@/shared/constants/chart-colors';

import type { FunnelStage } from '../types/conversion-analytics.types';
import type {
  DailyBounceTrendEntry,
  DailyEmailTrendEntry,
  EmailAnalyticsData,
} from '../types/email-analytics.types';
import type { InteractionQueryRow } from '../types/query-rows';
import { safeRate } from '../types/shared';

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

  let query = from(supabase, 'interactions')
    .select('type, lead_id, cadence_id, created_at')
    .eq('org_id', orgId)
    .eq('channel', 'email')
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  if (cadenceId) {
    query = query.eq('cadence_id', cadenceId);
  }
  if (leadIdFilter) {
    query = query.in('lead_id', leadIdFilter);
  }

  const { data: rawInteractions } = (await query) as { data: InteractionQueryRow[] | null };
  const interactions = rawInteractions ?? [];

  if (interactions.length === 0) {
    return emptyData();
  }

  return calculateEmailAnalytics(interactions);
}

function calculateEmailAnalytics(interactions: InteractionQueryRow[]): EmailAnalyticsData {
  const totalSent = interactions.filter((i) => i.type === 'sent').length;
  const totalBounced = interactions.filter((i) => i.type === 'bounced').length;
  // Estimate delivered as sent - bounced (Gmail doesn't provide delivery receipts)
  const totalDelivered = Math.max(0, totalSent - totalBounced);
  const totalOpened = interactions.filter((i) => i.type === 'opened').length;
  const totalClicked = interactions.filter((i) => i.type === 'clicked').length;
  const totalReplied = interactions.filter((i) => i.type === 'replied').length;

  const funnel = buildFunnel(totalSent, totalDelivered, totalOpened, totalClicked, totalReplied);
  const dailyTrend = buildDailyTrend(interactions);
  const bounceTrend = buildBounceTrend(interactions);

  return {
    totalSent,
    totalDelivered,
    totalOpened,
    totalClicked,
    totalReplied,
    totalBounced,
    openRate: safeRate(totalOpened, totalSent),
    clickRate: safeRate(totalClicked, totalSent),
    replyRate: safeRate(totalReplied, totalSent),
    funnel,
    dailyTrend,
    bounceTrend,
  };
}

function buildFunnel(
  sent: number,
  delivered: number,
  opened: number,
  clicked: number,
  replied: number,
): FunnelStage[] {
  return [
    { label: 'Enviados', count: sent, percentage: 100, color: INTERACTION_TYPE_COLORS.sent! },
    { label: 'Entregues', count: delivered, percentage: safeRate(delivered, sent), color: INTERACTION_TYPE_COLORS.delivered! },
    { label: 'Abertos', count: opened, percentage: safeRate(opened, sent), color: INTERACTION_TYPE_COLORS.opened! },
    { label: 'Clicados', count: clicked, percentage: safeRate(clicked, sent), color: INTERACTION_TYPE_COLORS.clicked! },
    { label: 'Respondidos', count: replied, percentage: safeRate(replied, sent), color: INTERACTION_TYPE_COLORS.replied! },
  ];
}

function buildDailyTrend(interactions: InteractionQueryRow[]): DailyEmailTrendEntry[] {
  const dayMap = new Map<string, { sent: number; opened: number; replied: number }>();

  for (const interaction of interactions) {
    if (interaction.type !== 'sent' && interaction.type !== 'opened' && interaction.type !== 'replied') continue;
    const dateStr = interaction.created_at.slice(0, 10);
    const entry = dayMap.get(dateStr) ?? { sent: 0, opened: 0, replied: 0 };
    if (interaction.type === 'sent') entry.sent++;
    else if (interaction.type === 'opened') entry.opened++;
    else if (interaction.type === 'replied') entry.replied++;
    dayMap.set(dateStr, entry);
  }

  return Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({
      date,
      label: formatDateLabel(date),
      ...counts,
    }));
}

function buildBounceTrend(interactions: InteractionQueryRow[]): DailyBounceTrendEntry[] {
  const dayMap = new Map<string, number>();

  for (const interaction of interactions) {
    if (interaction.type !== 'bounced') continue;
    const dateStr = interaction.created_at.slice(0, 10);
    dayMap.set(dateStr, (dayMap.get(dateStr) ?? 0) + 1);
  }

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
    totalDelivered: 0,
    totalOpened: 0,
    totalClicked: 0,
    totalReplied: 0,
    totalBounced: 0,
    openRate: 0,
    clickRate: 0,
    replyRate: 0,
    funnel: [],
    dailyTrend: [],
    bounceTrend: [],
  };
}
