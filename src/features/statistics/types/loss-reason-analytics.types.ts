export interface LossReasonEntry {
  reasonId: string;
  reasonName: string;
  count: number;
  percentage: number;
  color: string;
}

export interface LossByCadenceRow {
  cadenceId: string;
  cadenceName: string;
  enrolled: number;
  lost: number;
  lossRate: number;
  topReason: string;
}

export interface LossByCadenceStackedRow {
  cadenceId: string;
  cadenceName: string;
  totalLost: number;
  reasons: Array<{ reasonName: string; count: number; color: string }>;
}

export interface LossByUserStackedRow {
  userId: string;
  userName: string;
  totalLost: number;
  reasons: Array<{ reasonName: string; count: number; color: string }>;
}

export interface LossReasonAnalyticsData {
  totalLost: number;
  topReasonName: string;
  topReasonCount: number;
  overallLossRate: number;
  totalEnrolled: number;
  reasonsRanking: LossReasonEntry[];
  lossByCadence: LossByCadenceRow[];
  lossByCadenceStacked: LossByCadenceStackedRow[];
  lossByUserStacked: LossByUserStackedRow[];
}
