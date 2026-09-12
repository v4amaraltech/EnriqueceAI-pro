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
  actual: number | null; // cumulative até hoje; null nos dias que ainda não aconteceram (não plotados)
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

/**
 * KPI de SAO (Oportunidade Aceita por Vendas): reuniões realizadas do mês em
 * que o closer respondeu "Qualificada" no feedback. Mesma forma do KPI de
 * realizadas (`OpportunityKpiData`) + os totais que dão contexto ao número —
 * o SAO só existe desde 09/set/2026 e depende do closer responder.
 */
export interface SaoKpiData extends OpportunityKpiData {
  /** Reuniões realizadas no mesmo universo/janela do card de realizadas. */
  heldTotal: number;
  /** Realizadas cujo feedback preencheu a pergunta de SAO (true ou false). */
  evaluatedTotal: number;
  /** Realizadas aceitas pelo closer (= `totalOpportunities`). */
  qualifiedTotal: number;
}

export interface CadenceOption {
  id: string;
  name: string;
}

export interface DashboardData {
  kpi: OpportunityKpiData;
  saoKpi: SaoKpiData;
  availableCadences: CadenceOption[];
}

// Story 3.3: Ranking Cards

export interface SdrRankingEntry {
  userId: string;
  userName: string;
  avatarUrl?: string;
  value: number;
  secondaryValue?: number; // e.g., "prospecting" count for leads card
  /**
   * Ideal até hoje ESPECÍFICO deste SDR (pace por dia útil). Preenchido nos
   * cards de reuniões quando o SDR tem meta individual em `goals_per_user`.
   * Quando ausente, o card cai no `RankingCardData.idealToDate` compartilhado
   * (fatia da meta org ÷ nº de SDRs) — comportamento dos demais cards.
   */
  idealToDate?: number;
}

export interface RankingCardData {
  total: number;
  monthTarget: number;
  percentOfTarget: number; // positive = above, negative = below
  averagePerSdr: number;
  sdrBreakdown: SdrRankingEntry[];
  /**
   * Ideal COMPARTILHADO acumulado até hoje: fatia da meta org ÷ nº de SDRs
   * (fallback: SDRs ativos), paceada por dia útil (sem feriados) até hoje (BRT).
   * Usado por padrão em todos os cards e como fallback para SDR sem meta
   * individual. Nos cards de reuniões, cada SDR pode ter seu próprio ideal em
   * `SdrRankingEntry.idealToDate`. `undefined` quando não há meta ou SDRs.
   */
  idealToDate?: number;
  /** Daily cumulative actual vs target — populated for cards that want a chart. */
  dailyData?: DailyDataPoint[];
}

export interface RankingData {
  leadsFinished: RankingCardData;
  activitiesDone: RankingCardData;
  attendanceRate: RankingCardData; // total is a percentage (0-100) — reuniões realizadas ÷ marcadas (inverso do no-show)
  leadsOpened: RankingCardData;
  meetingsScheduled: RankingCardData;
  meetingsHeld: RankingCardData;
  hitRate: RankingCardData; // total is a percentage (0-100)
  sao: RankingCardData; // reuniões realizadas aceitas pelo closer (SAO = true no feedback mais recente)
  saoRate: RankingCardData; // total is a percentage (0-100) — SAO ÷ reuniões realizadas
  leadsToOpen: RankingCardData; // snapshot atual — leads novos sem cadência ativa por SDR
  overdueActivities: RankingCardData; // snapshot atual — atividades de cadência atrasadas (>= OVERDUE_THRESHOLD_HOURS, default 4h) por SDR
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
  leadsOpenedTarget: number; // meta individual de leads abertos no mês
  previousTarget: number | null; // referência do mês anterior (leads abertos)
  meetingsScheduledTarget: number; // meta individual de reuniões marcadas
  meetingsHeldTarget: number; // meta individual de reuniões realizadas
  callsTarget: number; // meta individual de ligações (outbound) no mês
  callsConnectedTarget: number; // meta individual de ligações conectadas no mês
  saoTarget: number; // meta individual de SAO (reuniões realizadas aceitas pelo closer)
}

export interface GoalsData {
  month: string; // YYYY-MM
  leadsFinishedTarget: number;
  activitiesTarget: number;
  conversionTarget: number;
  leadsOpenedTarget: number;
  meetingsScheduledTarget: number;
  meetingsHeldTarget: number;
  saoTarget: number;
  userGoals: UserGoalRow[];
}

// Seção "SDR selecionado" — realizado × meta individual do mês

export interface SdrPaceVolumes {
  leadsOpened: number;
  meetingsScheduled: number;
  meetingsHeld: number;
  calls: number;
  callsConnected: number;
}

export interface SdrPaceMetrics {
  actual: SdrPaceVolumes;
  /** Metas individuais (`goals_per_user`) do SDR no mês; 0 = sem meta. */
  target: SdrPaceVolumes;
}

export interface SdrOption {
  userId: string;
  userName: string;
  avatarUrl?: string;
}

export interface SdrPaceData {
  month: string; // YYYY-MM
  sdrs: SdrOption[];
  /** `null` quando a org não tem SDR ativo. */
  selectedUserId: string | null;
  metrics: SdrPaceMetrics | null;
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
