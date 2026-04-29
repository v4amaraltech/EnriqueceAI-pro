import type { ChannelType, InteractionType } from '@/features/cadences/types';
import type { EnrichmentStatus, LeadAddress, LeadEmail, LeadPhone, LeadSocio, LeadStatus } from '@/features/leads/types';

// Lead info embedded in a pending activity
export interface ActivityLead {
  id: string;
  org_id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string;
  email: string | null;
  telefone: string | null;
  municipio: string | null;
  uf: string | null;
  porte: string | null;
  first_name: string | null;
  last_name: string | null;
  primeiro_nome: string | null;
  // Enrichment data for sidebar
  socios: LeadSocio[] | null;
  endereco: LeadAddress | null;
  instagram: string | null;
  linkedin: string | null;
  website: string | null;
  status: LeadStatus | null;
  enrichment_status: EnrichmentStatus | null;
  notes: string | null;
  fit_score: number | null;
  engagement_score: number | null;
  is_inbound: boolean;
  created_at: string;
  phones: LeadPhone[] | null;
  emails: LeadEmail[] | null;
  job_title: string | null;
  lead_source: string | null;
  canal: string | null;
  segmento: string | null;
  assigned_to: string | null;
  custom_field_values: Record<string, string> | null;
}

// A single pending activity derived from enrollment + step + cadence
export interface PendingActivity {
  enrollmentId: string;
  cadenceId: string;
  cadenceName: string;
  cadenceCreatedBy: string | null;
  stepId: string;
  stepOrder: number;
  totalSteps: number;
  channel: ChannelType;
  templateId: string | null;
  templateSubject: string | null;
  templateBody: string | null;
  aiPersonalization: boolean;
  nextStepDue: string;
  isCurrentStep: boolean;
  lead: ActivityLead;
  activityName: string | null;
  callScript: string | null;
}

// Prepared email ready for review/send
export interface PreparedEmail {
  to: string;
  subject: string;
  body: string;
  aiPersonalized: boolean;
}

// Prepared WhatsApp message ready for review/send
export interface PreparedWhatsApp {
  to: string;
  body: string;
  aiPersonalized: boolean;
}

// Input for executing an activity (sending email or WhatsApp)
export interface ExecuteActivityInput {
  enrollmentId: string;
  cadenceId: string;
  stepId: string;
  leadId: string;
  orgId: string;
  cadenceCreatedBy: string;
  channel: ChannelType;
  to: string;
  subject: string;
  body: string;
  aiGenerated: boolean;
  templateId: string | null;
}

// Timeline entry for mini-timeline in execution sheet
export interface ActivityTimelineEntry {
  id: string;
  type: InteractionType;
  channel: ChannelType;
  message_content: string | null;
  ai_generated: boolean;
  created_at: string;
  cadence_name?: string;
  step_order?: number;
}
