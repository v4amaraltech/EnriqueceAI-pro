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

/**
 * Prospecting cadence e-mail metrics (see services/email-scope.ts).
 * `totalSent` counts e-mails; every other total counts distinct leads.
 */
export interface EmailAnalyticsData {
  /** E-mails de cadência que saíram pelo Gmail. */
  totalSent: number;
  /** Leads que receberam ao menos um desses e-mails. */
  emailedLeads: number;
  /** Leads que receberam e não deram bounce. */
  totalDelivered: number;
  /** Leads que abriram. */
  totalOpened: number;
  /** Leads que clicaram. */
  totalClicked: number;
  /** Leads que responderam (1 por lead). */
  totalReplied: number;
  /** Leads com bounce (1 por lead). */
  totalBounced: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  /** Leads com bounce ÷ leads que receberam e-mail. */
  bounceRate: number;
  funnel: FunnelStage[];
  dailyTrend: DailyEmailTrendEntry[];
  bounceTrend: DailyBounceTrendEntry[];
}
