export type DrilldownMetric =
  | 'overall_leads'
  | 'overall_contacted'
  | 'overall_replied'
  | 'overall_meetings'
  | 'overall_qualified'
  | 'cadence_enrollments'
  | 'sdr_activities'
  | 'activity_total'
  | 'activity_today'
  | 'conversion_stage';

export interface DrilldownFilters {
  from: string;
  to: string;
  sdrId?: string;
  cadenceId?: string;
  stage?: string;
}

export interface DrilldownColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
}

export interface DrilldownRow {
  id: string;
  leadId?: string;
  [key: string]: unknown;
}

export interface DrilldownResult {
  data: DrilldownRow[];
  total: number;
  page: number;
}

export interface DrilldownState {
  isOpen: boolean;
  metric: DrilldownMetric | null;
  filters: DrilldownFilters | null;
  data: DrilldownRow[];
  total: number;
  page: number;
  isLoading: boolean;
  title: string;
  columns: DrilldownColumn[];
  open: (metric: DrilldownMetric, filters: DrilldownFilters) => void;
  close: () => void;
  goToPage: (page: number) => void;
}
