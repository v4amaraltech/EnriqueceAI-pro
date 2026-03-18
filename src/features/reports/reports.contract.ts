export type ReportPeriod = '7d' | '30d' | '90d';
export interface ReportDateRange {
  from: string;
  to: string;
}
export type ReportView = 'cadence' | 'sdr' | 'overall';

export interface CadenceMetrics {
  cadenceId: string;
  cadenceName: string;
  totalEnrollments: number;
  sent: number;
  delivered: number;
  opened: number;
  replied: number;
  bounced: number;
  meetings: number;
  openRate: number;
  replyRate: number;
  bounceRate: number;
  conversionRate: number;
}

export interface SdrMetrics {
  userId: string;
  userName: string;
  leadsWorked: number;
  messagesSent: number;
  replies: number;
  meetings: number;
  conversionRate: number;
}

export interface OverallMetrics {
  totalLeads: number;
  contacted: number;
  replied: number;
  meetings: number;
  qualified: number;
  funnelSteps: FunnelStep[];
}

export interface FunnelStep {
  label: string;
  count: number;
  percentage: number;
  color: string;
}

export interface ReportData {
  cadenceMetrics: CadenceMetrics[];
  sdrMetrics: SdrMetrics[];
  overallMetrics: OverallMetrics;
}

// Raw data from DB queries
export interface RawInteraction {
  type: string;
  cadence_id: string | null;
  lead_id: string;
  created_at: string;
  performed_by?: string | null;
}

export interface RawCadence {
  id: string;
  name: string;
}

export interface RawEnrollment {
  cadence_id: string;
  lead_id: string;
  status: string;
  enrolled_by: string | null;
}

export interface RawLead {
  id: string;
  status: string;
}

export interface RawMember {
  user_id: string;
  user_email: string;
}
