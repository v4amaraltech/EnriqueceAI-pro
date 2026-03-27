import type {
  CadenceEnrollmentRow,
  CadenceRow,
  CadenceStepRow,
  InteractionRow,
  MessageTemplateRow,
} from './types';

export type {
  CadenceRow,
  CadenceStepRow,
  CadenceEnrollmentRow,
  MessageTemplateRow,
  InteractionRow,
};

// Cadence with its steps loaded
export interface CadenceWithSteps extends CadenceRow {
  steps: CadenceStepRow[];
}

// Cadence step with template data loaded
export interface CadenceStepWithTemplate extends CadenceStepRow {
  template: MessageTemplateRow | null;
  template_b: MessageTemplateRow | null;
}

// Full cadence detail with steps and templates
export interface CadenceDetail extends CadenceRow {
  steps: CadenceStepWithTemplate[];
  enrollment_count: number;
}

// Cadence list result
export interface CadenceListResult {
  data: CadenceRow[];
  total: number;
  page: number;
  per_page: number;
}

// Template list result
export interface TemplateListResult {
  data: MessageTemplateRow[];
  total: number;
  page: number;
  per_page: number;
}

// Enrollment with lead name for display
export interface EnrollmentWithLead extends CadenceEnrollmentRow {
  lead_name: string | null;
  lead_cnpj: string;
}

// Enrollment list result
export interface EnrollmentListResult {
  data: EnrollmentWithLead[];
  total: number;
}

// Cadence metrics
export interface CadenceMetrics {
  total_enrolled: number;
  in_progress: number;
  completed: number;
  replied: number;
  bounced: number;
}

// Auto email cadence metrics (inline table)
export interface AutoEmailCadenceMetrics {
  cadenceId: string;
  active: number;
  paused: number;
  completed: number;
  replied: number;
  bounced: number;
  sent: number;
  delivered: number;
  opened: number;
  failed: number;
  meetings: number;
  replyRate: number;
  openRate: number;
}

// A/B variant rates with computed percentages
export interface AbVariantRates {
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  openRate: number;
  replyRate: number;
  bounceRate: number;
}

// A/B test per-step metrics
export interface StepAbMetrics {
  stepId: string;
  stepOrder: number;
  variant_a: AbVariantRates;
  variant_b: AbVariantRates;
  confidence: 'low' | 'medium' | 'high';
  pValue: number | null;
  canDeclareWinner: boolean;
  winnerVariant: 'A' | 'B' | null;
  winnerAt: string | null;
}

// Performance dashboard types
export type PerformancePeriod = '7d' | '30d' | '90d' | 'all';

export interface StepPerformanceMetrics {
  stepId: string;
  stepOrder: number;
  channel: string;
  activityName: string | null;
  abEnabled: boolean;
  abWinnerVariant: 'A' | 'B' | null;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  pending: number;
  openRate: number;
  replyRate: number;
  bounceRate: number;
  completionRate: number;
}

export interface CadencePerformanceData {
  cadenceId: string;
  cadenceName: string;
  cadenceType: 'standard' | 'auto_email';
  summary: {
    sent: number;
    opened: number;
    replied: number;
    bounced: number;
    meetings: number;
    openRate: number;
    replyRate: number;
    bounceRate: number;
    conversionRate: number;
  };
  enrollments: {
    active: number;
    paused: number;
    completed: number;
    replied: number;
    bounced: number;
    unsubscribed: number;
    total: number;
  };
  steps: StepPerformanceMetrics[];
}

// Interaction timeline entry
export interface TimelineEntry {
  id: string;
  type: InteractionRow['type'];
  channel: InteractionRow['channel'];
  message_content: string | null;
  subject: string | null;
  html_body: string | null;
  ai_generated: boolean;
  is_note: boolean;
  created_at: string;
  cadence_name?: string;
  step_order?: number;
  step_activity_name?: string;
  step_instructions?: string;
  metadata?: Record<string, unknown> | null;
}
