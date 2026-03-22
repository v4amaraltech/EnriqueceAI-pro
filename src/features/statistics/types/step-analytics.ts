export interface CadenceStepMetrics {
  stepId: string;
  stepOrder: number;
  channel: string;
  activityName: string | null;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  meetingScheduled: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
}

export interface CadenceStepAnalyticsData {
  cadenceId: string;
  steps: CadenceStepMetrics[];
  totalSent: number;
  engagedLeads: number;
  engagementRate: number;
}
