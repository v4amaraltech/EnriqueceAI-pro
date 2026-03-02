import type { FunnelStage } from './conversion-analytics.types';

export interface DailyEmailTrendEntry {
  date: string;
  label: string;
  sent: number;
  opened: number;
  replied: number;
}

export interface DailyBounceTrendEntry {
  date: string;
  label: string;
  bounced: number;
}

export interface EmailAnalyticsData {
  totalSent: number;
  totalDelivered: number;
  totalOpened: number;
  totalClicked: number;
  totalReplied: number;
  totalBounced: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  funnel: FunnelStage[];
  dailyTrend: DailyEmailTrendEntry[];
  bounceTrend: DailyBounceTrendEntry[];
}
