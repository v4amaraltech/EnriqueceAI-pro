export interface FeedbackKpis {
  totalSent: number;
  totalResponded: number;
  responseRate: number;
  averageRating: number | null;
  averageResponseTimeHours: number | null;
  pendingCount: number;
  /** % de oportunidades aceitas pelo closer (SAO) entre as que ele avaliou. */
  saoRate: number | null;
  /** Feedbacks com SAO respondido — denominador de `saoRate`. */
  saoAnswered: number;
  saoQualified: number;
}

export interface FeedbackRow {
  id: string;
  leadId: string;
  leadName: string;
  closerId: string;
  closerName: string;
  result: string | null;
  rating: number | null;
  /** SAO — true qualificada, false não qualificada, null não respondido. */
  oportunidadeQualificada: boolean | null;
  comment: string | null;
  sentAt: string;
  respondedAt: string | null;
  expiresAt: string | null;
  status: 'responded' | 'pending' | 'expired';
}

export interface CloserRankingEntry {
  closerId: string;
  closerName: string;
  totalReceived: number;
  totalResponded: number;
  responseRate: number;
  averageRating: number | null;
  saoRate: number | null;
  saoAnswered: number;
}

export interface FeedbackAnalyticsData {
  kpis: FeedbackKpis;
  feedbacks: FeedbackRow[];
  closerRanking: CloserRankingEntry[];
}
