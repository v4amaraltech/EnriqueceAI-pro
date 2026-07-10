export type ReminderContext = 'inbound' | 'outbound';

/** One row of `public.v_reminders_due` — a lead × due reminder step. */
export interface ReminderDueRow {
  org_id: string;
  lead_id: string;
  sdr_user_id: string;
  first_name: string | null;
  last_name: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  email: string | null;
  meeting_scheduled_at: string;
  meeting_starts_at: string;
  meet_link: string | null;
  calendar_event_id: string | null;
  reminder_step_id: string;
  context: ReminderContext;
  step_order: number;
  channel: 'email' | 'whatsapp';
  message_template_id: string | null;
  fire_at: string;
}

export type ReminderOutcome = 'sent' | 'failed' | 'skipped';

export interface ReminderRunSummary {
  enabled: boolean;
  due: number;
  sent: number;
  failed: number;
  skipped: number;
  details: Array<{
    lead_id: string;
    step: number;
    channel: string;
    outcome: ReminderOutcome;
    reason?: string;
  }>;
}
