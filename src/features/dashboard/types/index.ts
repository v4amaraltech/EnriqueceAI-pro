export interface DashboardFilters {
  month: string; // YYYY-MM format
  cadenceIds: string[];
  userIds: string[];
  /** Override date range (ISO date strings). When set, takes precedence over month. */
  dateFrom?: string;
  dateTo?: string;
  /** Filter by sub-origens (canal field). When set, only leads with these canais are counted. */
  subOrigins?: string[];
}

export interface DailyDataPoint {
  date: string; // YYYY-MM-DD
  day: number;
  actual: number; // cumulative
  target: number; // linear projection
}

export interface OpportunityKpiData {
  totalOpportunities: number;
  monthTarget: number;
  conversionTarget: number;
  percentOfTarget: number; // positive = above, negative = below
  currentDay: number;
  daysInMonth: number;
  dailyData: DailyDataPoint[];
}

export interface CadenceOption {
  id: string;
  name: string;
}

export interface DashboardData {
  kpi: OpportunityKpiData;
  availableCadences: CadenceOption[];
}

// Story 3.3: Ranking Cards

export interface SdrRankingEntry {
  userId: string;
  userName: string;
  avatarUrl?: string;
  value: number;
  secondaryValue?: number; // e.g., "prospecting" count for leads card
}

export interface RankingCardData {
  total: number;
  monthTarget: number;
  percentOfTarget: number; // positive = above, negative = below
  averagePerSdr: number;
  sdrBreakdown: SdrRankingEntry[];
}

export interface RankingData {
  leadsFinished: RankingCardData;
  activitiesDone: RankingCardData;
  conversionRate: RankingCardData; // total is a percentage (0-100)
}

// Story 3.4: Insights Charts

export interface LossReasonEntry {
  reason: string;
  count: number;
  percent: number;
}

export interface ConversionByOriginEntry {
  origin: string; // 'Inbound Ativo' | 'Inbound Passivo' | 'Outbound'
  converted: number;
  lost: number;
}

export interface InsightsData {
  lossReasons: LossReasonEntry[];
  conversionByOrigin: ConversionByOriginEntry[];
}

// Story 3.5: Goals Modal

export interface UserGoalRow {
  userId: string;
  userName: string;
  avatarUrl?: string;
  opportunityTarget: number;
  previousTarget: number | null; // previous month reference
}

export interface GoalsData {
  month: string; // YYYY-MM
  opportunityTarget: number;
  leadsFinishedTarget: number;
  activitiesTarget: number;
  conversionTarget: number;
  userGoals: UserGoalRow[];
}

export interface ResponseTimeByUser {
  userId: string;
  userName: string;
  avatarUrl: string | null;
  leadsApproached: number;
  withinThreshold: number;
  withinThresholdPct: number;
}

export interface DashboardResponseTimeData {
  thresholdMinutes: number;
  overallPct: number;
  totalLeads: number;
  byUser: ResponseTimeByUser[];
}
