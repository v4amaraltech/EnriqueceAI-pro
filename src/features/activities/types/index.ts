import type { CallProvider, ChannelType, InteractionType } from '@/features/cadences/types';
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
  meeting_scheduled_at: string | null;
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
  /**
   * Dia da cadência em que o passo cai (1 + soma dos `delay_days` até ele).
   * Ausente em retornos agendados.
   */
  stepDay?: number;
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
  // 'whatsapp' = passo de Ligação via WhatsApp (channel='phone'); senão null (Epic 7).
  callProvider: CallProvider | null;
  /**
   * Adiamentos ("Adiar p/ amanhã") já usados no passo atual do enrollment.
   * Só faz sentido para `isCurrentStep`; retornos agendados usam 0.
   */
  snoozeCount: number;
  /**
   * Só para atividade avulsa (`scheduled_activities`): 'return' = retorno
   * agendado pelo SDR; 'limbo_followup' = tarefa "Definir destino" do robô;
   * 'anti_no_show' = tarefa da cadência anti no-show.
   * (gravada com channel='research' por falta de canal próprio). Ausente nos
   * passos de cadência.
   */
  scheduledKind?: ScheduledActivityKind;
}

export type ScheduledActivityKind = 'return' | 'limbo_followup' | 'anti_no_show';

/** Tarefa "Definir destino" (lead parado sem próxima atividade). */
export function isLimboFollowup(activity: Pick<PendingActivity, 'scheduledKind'>): boolean {
  return activity.scheduledKind === 'limbo_followup';
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
  contactId?: string | null;
  subject: string;
  body: string;
  aiGenerated: boolean;
  templateId: string | null;
  /**
   * SDR já enviou a mensagem por fora (WhatsApp pessoal, Gmail direto). Grava a
   * interaction como enviada no canal do passo e avança a cadência, mas NÃO
   * dispara nada pela API nem debita crédito.
   */
  manualSend?: boolean;
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
