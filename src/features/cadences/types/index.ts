// Cadence status enum matching database
export type CadenceStatus = 'draft' | 'active' | 'paused' | 'archived';

// Cadence priority enum matching database
export type CadencePriority = 'high' | 'medium' | 'low';

// Cadence origin enum matching database
export type CadenceOrigin = 'inbound_active' | 'inbound_passive' | 'outbound';

// Cadence type enum matching database
export type CadenceType = 'standard' | 'auto_email';

// Enrollment status enum matching database
export type EnrollmentStatus = 'active' | 'paused' | 'completed' | 'replied' | 'bounced' | 'unsubscribed';

// Channel type enum matching database
export type ChannelType = 'email' | 'whatsapp' | 'phone' | 'linkedin' | 'research';

// Reply type for auto email steps
export type ReplyType = 'new_conversation' | 'reply';

// Interaction type enum matching database
export type InteractionType =
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'replied'
  | 'bounced'
  | 'failed'
  | 'meeting_scheduled';

// Cadence row matching database table
export interface CadenceRow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  status: CadenceStatus;
  priority: CadencePriority;
  origin: CadenceOrigin;
  type: CadenceType;
  total_steps: number;
  auto_loss_after_days: number | null;
  auto_loss_reason_id: string | null;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

// Cadence step row matching database table
export interface CadenceStepRow {
  id: string;
  cadence_id: string;
  step_order: number;
  channel: ChannelType;
  template_id: string | null;
  delay_days: number;
  delay_hours: number;
  ai_personalization: boolean;
  activity_name: string | null;
  instructions: string | null;
  reply_type: ReplyType;
  template_id_b: string | null;
  ab_enabled: boolean;
  ab_distribution: number;
  ab_winner_variant: 'A' | 'B' | null;
  ab_winner_at: string | null;
  ab_enabled_at: string | null;
  created_at: string;
}

// Cadence enrollment row matching database table
export interface CadenceEnrollmentRow {
  id: string;
  cadence_id: string;
  lead_id: string;
  current_step: number;
  status: EnrollmentStatus;
  next_step_due: string | null;
  enrolled_by: string | null;
  enrolled_at: string;
  completed_at: string | null;
  updated_at: string;
}

// Message template row matching database table
export interface MessageTemplateRow {
  id: string;
  org_id: string;
  name: string;
  channel: ChannelType;
  subject: string | null;
  body: string;
  variables_used: string[];
  is_system: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Interaction row matching database table
export interface InteractionRow {
  id: string;
  org_id: string;
  lead_id: string;
  cadence_id: string | null;
  step_id: string | null;
  channel: ChannelType;
  type: InteractionType;
  message_content: string | null;
  external_id: string | null;
  metadata: Record<string, unknown> | null;
  ai_generated: boolean;
  original_template_id: string | null;
  created_at: string;
}

// Insert types (without auto-generated fields)
export interface CadenceInsert {
  org_id: string;
  name: string;
  description?: string | null;
  status?: CadenceStatus;
  priority?: CadencePriority;
  origin?: CadenceOrigin;
  type?: CadenceType;
  total_steps?: number;
  auto_loss_after_days?: number | null;
  auto_loss_reason_id?: string | null;
  created_by?: string | null;
}

export interface CadenceStepInsert {
  cadence_id: string;
  step_order: number;
  channel: ChannelType;
  template_id?: string | null;
  delay_days?: number;
  delay_hours?: number;
  ai_personalization?: boolean;
  activity_name?: string | null;
  instructions?: string | null;
  reply_type?: ReplyType;
}

export interface CadenceEnrollmentInsert {
  cadence_id: string;
  lead_id: string;
  current_step?: number;
  status?: EnrollmentStatus;
  enrolled_by?: string | null;
}

export interface MessageTemplateInsert {
  org_id: string;
  name: string;
  channel: ChannelType;
  subject?: string | null;
  body: string;
  variables_used?: string[];
  is_system?: boolean;
  created_by?: string | null;
}

export interface InteractionInsert {
  org_id: string;
  lead_id: string;
  cadence_id?: string | null;
  step_id?: string | null;
  channel: ChannelType;
  type: InteractionType;
  message_content?: string | null;
  external_id?: string | null;
  metadata?: Record<string, unknown> | null;
  ai_generated?: boolean;
  original_template_id?: string | null;
}
