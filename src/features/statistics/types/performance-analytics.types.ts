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

export interface DailyControlRow {
  userId: string;
  userName: string;
  prospecting: number;
  available: number;
  won: number;
  lost: number;
  pending: number;
  completed: number;
  ignored: number;
  calls: number;
  emails: number;
  research: number;
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
  dailyControl: DailyControlRow[];
}
