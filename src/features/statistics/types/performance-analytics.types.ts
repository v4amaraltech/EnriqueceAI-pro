export interface SdrPerformanceRow {
  userId: string;
  userEmail: string;
  activities: number;
  leadsCreated: number;
  qualified: number;
  qualificationRate: number;
  meetings: number;
}

export interface SdrActivityComparisonEntry {
  userEmail: string;
  activities: number;
}

export interface DailySdrPerformanceEntry {
  date: string;
  label: string;
  [sdrEmail: string]: string | number;
}

export interface PerformanceAnalyticsData {
  totalActivities: number;
  totalLeadsCreated: number;
  totalQualified: number;
  qualificationRate: number;
  sdrTable: SdrPerformanceRow[];
  sdrComparison: SdrActivityComparisonEntry[];
  dailySdrTrend: DailySdrPerformanceEntry[];
  dailySdrKeys: string[];
}
