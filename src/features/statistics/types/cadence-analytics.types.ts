export interface CadencePerformanceRow {
  cadenceId: string;
  cadenceName: string;
  status: string;
  priority: string | null;
  enrolled: number;
  completed: number;
  replied: number;
  rate: number;
}

export interface EnrollmentsByStatusEntry {
  cadenceName: string;
  active: number;
  paused: number;
  completed: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
}

export interface StepProgressionEntry {
  stepLabel: string;
  stepOrder: number;
  count: number;
}

export interface CadenceAnalyticsData {
  activeCadences: number;
  totalEnrolled: number;
  completionRate: number;
  replyRate: number;
  cadenceTable: CadencePerformanceRow[];
  enrollmentsByStatus: EnrollmentsByStatusEntry[];
  stepProgression: StepProgressionEntry[];
}
