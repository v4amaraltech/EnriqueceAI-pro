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

export interface LossReasonAnalyticsData {
  totalLost: number;
  topReasonName: string;
  topReasonCount: number;
  overallLossRate: number;
  totalEnrolled: number;
  reasonsRanking: LossReasonEntry[];
  lossByCadence: LossByCadenceRow[];
}
