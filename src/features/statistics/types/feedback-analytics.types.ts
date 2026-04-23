export interface FeedbackKpis {
  totalSent: number;
  totalResponded: number;
  responseRate: number;
  averageRating: number | null;
  averageResponseTimeHours: number | null;
  pendingCount: number;
}

export interface FeedbackRow {
  id: string;
  leadId: string;
  leadName: string;
  closerId: string;
  closerName: string;
  result: string | null;
  rating: number | null;
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
}

export interface FeedbackAnalyticsData {
  kpis: FeedbackKpis;
  feedbacks: FeedbackRow[];
  closerRanking: CloserRankingEntry[];
}
