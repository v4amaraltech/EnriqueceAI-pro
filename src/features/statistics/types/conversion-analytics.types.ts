export interface FunnelStage {
  label: string;
  count: number;
  percentage: number;
  color: string;
}

export interface StageConversion {
  from: string;
  to: string;
  rate: number;
  numerator: number;
  denominator: number;
}

export interface PipelineVelocity {
  avgDaysToQualification: number;
  medianDaysToQualification: number;
  totalQualified: number;
}

export interface CadenceConversionRow {
  cadenceId: string;
  cadenceName: string;
  enrollments: number;
  contacted: number;
  /** Leads currently in 'qualified' (meeting scheduled, not yet confirmed). */
  qualified: number;
  /** Leads currently in 'won' (closer confirmed meeting_done). */
  won: number;
  /** Cadence-level deprecated metrics kept on the type for back-compat with
   *  other tables that consume CadenceConversionRow elsewhere. Not rendered in
   *  ConversionByCadenceTable anymore. */
  replies: number;
  meetings: number;
  /** won / enrollments — final conversion rate. */
  conversionRate: number;
}

export interface ConversionByOriginEntry {
  origin: string;
  qualified: number;
  unqualified: number;
  total: number;
  conversionRate: number;
}

export interface ConversionAnalyticsData {
  funnel: FunnelStage[];
  stageConversions: StageConversion[];
  velocity: PipelineVelocity;
  cadenceConversion: CadenceConversionRow[];
  conversionByOrigin: ConversionByOriginEntry[];
}
