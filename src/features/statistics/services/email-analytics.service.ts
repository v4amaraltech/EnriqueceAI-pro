import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { INTERACTION_TYPE_COLORS } from '@/shared/constants/chart-colors';

import type { FunnelStage } from '../types/conversion-analytics.types';
import type {
  DailyBounceTrendEntry,
  DailyEmailTrendEntry,
  EmailAnalyticsData,
} from '../types/email-analytics.types';
import { safeRate } from '../types/shared';

interface InteractionRow {
  type: string;
  lead_id: string;
  cadence_id: string | null;
  created_at: string;
}

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
    const { data: enrollments } = (await from(supabase, 'cadence_enrollments')
      .select('lead_id')
      .eq('org_id', orgId)
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

  const { data: rawInteractions } = (await query) as { data: InteractionRow[] | null };
  const interactions = rawInteractions ?? [];

  if (interactions.length === 0) {
    return emptyData();
  }

  return calculateEmailAnalytics(interactions);
}

function calculateEmailAnalytics(interactions: InteractionRow[]): EmailAnalyticsData {
  const totalSent = interactions.filter((i) => i.type === 'sent').length;
  const totalDelivered = interactions.filter((i) => i.type === 'delivered').length;
  const totalOpened = interactions.filter((i) => i.type === 'opened').length;
  const totalClicked = interactions.filter((i) => i.type === 'clicked').length;
  const totalReplied = interactions.filter((i) => i.type === 'replied').length;
  const totalBounced = interactions.filter((i) => i.type === 'bounced').length;

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

function buildDailyTrend(interactions: InteractionRow[]): DailyEmailTrendEntry[] {
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

function buildBounceTrend(interactions: InteractionRow[]): DailyBounceTrendEntry[] {
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

function formatDateLabel(dateStr: string): string {
  const parts = dateStr.split('-');
  const month = parts[1];
  const day = parts[2];
  if (!month || !day) return dateStr;
  return `${day}/${month}`;
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
