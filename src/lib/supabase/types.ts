export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      _bkp_cadence_enrolled_backfill_20260909: {
        Row: {
          created_at_backfilled: string | null;
          enrollment_id: string | null;
          inserted_at: string;
          interaction_id: string;
          lead_id: string | null;
        };
        Insert: {
          created_at_backfilled?: string | null;
          enrollment_id?: string | null;
          inserted_at?: string;
          interaction_id: string;
          lead_id?: string | null;
        };
        Update: {
          created_at_backfilled?: string | null;
          enrollment_id?: string | null;
          inserted_at?: string;
          interaction_id?: string;
          lead_id?: string | null;
        };
        Relationships: [];
      };
      _bkp_cadence_limbo_triage_20260812: {
        Row: {
          batch: string | null;
          bucket: string | null;
          cadence_id: string | null;
          enrollment_id: string | null;
          kind: string | null;
          lead_id: string | null;
          old_completed_at: string | null;
          old_status: string | null;
          snapshot_at: string | null;
        };
        Insert: {
          batch?: string | null;
          bucket?: string | null;
          cadence_id?: string | null;
          enrollment_id?: string | null;
          kind?: string | null;
          lead_id?: string | null;
          old_completed_at?: string | null;
          old_status?: string | null;
          snapshot_at?: string | null;
        };
        Update: {
          batch?: string | null;
          bucket?: string | null;
          cadence_id?: string | null;
          enrollment_id?: string | null;
          kind?: string | null;
          lead_id?: string | null;
          old_completed_at?: string | null;
          old_status?: string | null;
          snapshot_at?: string | null;
        };
        Relationships: [];
      };
      _bkp_inbound_backlog_cleanup_20260818: {
        Row: {
          backed_up_at: string | null;
          cadence_id: string | null;
          completed_at: string | null;
          current_step: number | null;
          enrolled_at: string | null;
          enrolled_by: string | null;
          id: string | null;
          lead_id: string | null;
          loss_notes: string | null;
          loss_reason_id: string | null;
          next_step_due: string | null;
          org_id: string | null;
          scheduled_start_at: string | null;
          status: Database['public']['Enums']['enrollment_status'] | null;
          updated_at: string | null;
        };
        Insert: {
          backed_up_at?: string | null;
          cadence_id?: string | null;
          completed_at?: string | null;
          current_step?: number | null;
          enrolled_at?: string | null;
          enrolled_by?: string | null;
          id?: string | null;
          lead_id?: string | null;
          loss_notes?: string | null;
          loss_reason_id?: string | null;
          next_step_due?: string | null;
          org_id?: string | null;
          scheduled_start_at?: string | null;
          status?: Database['public']['Enums']['enrollment_status'] | null;
          updated_at?: string | null;
        };
        Update: {
          backed_up_at?: string | null;
          cadence_id?: string | null;
          completed_at?: string | null;
          current_step?: number | null;
          enrolled_at?: string | null;
          enrolled_by?: string | null;
          id?: string | null;
          lead_id?: string | null;
          loss_notes?: string | null;
          loss_reason_id?: string | null;
          next_step_due?: string | null;
          org_id?: string | null;
          scheduled_start_at?: string | null;
          status?: Database['public']['Enums']['enrollment_status'] | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      _bkp_inbound_recovery_retro_20260831: {
        Row: {
          applied: boolean | null;
          backed_up_at: string | null;
          lead_id: string | null;
          loss_reason_id: string | null;
          lost_at: string | null;
          new_assigned_to: string | null;
          prev_assigned_to: string | null;
          reason_name: string | null;
          rn: number | null;
          scheduled_start_at: string | null;
        };
        Insert: {
          applied?: boolean | null;
          backed_up_at?: string | null;
          lead_id?: string | null;
          loss_reason_id?: string | null;
          lost_at?: string | null;
          new_assigned_to?: string | null;
          prev_assigned_to?: string | null;
          reason_name?: string | null;
          rn?: number | null;
          scheduled_start_at?: string | null;
        };
        Update: {
          applied?: boolean | null;
          backed_up_at?: string | null;
          lead_id?: string | null;
          loss_reason_id?: string | null;
          lost_at?: string | null;
          new_assigned_to?: string | null;
          prev_assigned_to?: string | null;
          reason_name?: string | null;
          rn?: number | null;
          scheduled_start_at?: string | null;
        };
        Relationships: [];
      };
      _bkp_inbound20_migration_20260818: {
        Row: {
          cadence_id: string | null;
          completed_at: string | null;
          current_step: number | null;
          enrolled_at: string | null;
          enrolled_by: string | null;
          id: string | null;
          lead_id: string | null;
          loss_notes: string | null;
          loss_reason_id: string | null;
          next_step_due: string | null;
          org_id: string | null;
          scheduled_start_at: string | null;
          status: Database['public']['Enums']['enrollment_status'] | null;
          updated_at: string | null;
        };
        Insert: {
          cadence_id?: string | null;
          completed_at?: string | null;
          current_step?: number | null;
          enrolled_at?: string | null;
          enrolled_by?: string | null;
          id?: string | null;
          lead_id?: string | null;
          loss_notes?: string | null;
          loss_reason_id?: string | null;
          next_step_due?: string | null;
          org_id?: string | null;
          scheduled_start_at?: string | null;
          status?: Database['public']['Enums']['enrollment_status'] | null;
          updated_at?: string | null;
        };
        Update: {
          cadence_id?: string | null;
          completed_at?: string | null;
          current_step?: number | null;
          enrolled_at?: string | null;
          enrolled_by?: string | null;
          id?: string | null;
          lead_id?: string | null;
          loss_notes?: string | null;
          loss_reason_id?: string | null;
          next_step_due?: string | null;
          org_id?: string | null;
          scheduled_start_at?: string | null;
          status?: Database['public']['Enums']['enrollment_status'] | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      _bkp_ismael_redistrib_20260910: {
        Row: {
          engagement_score: number | null;
          lead_id: string | null;
          moved_at: string | null;
          new_assigned_to: string | null;
          new_nome: string | null;
          old_assigned_to: string | null;
          old_status: Database['public']['Enums']['lead_status'] | null;
          org_id: string | null;
        };
        Insert: {
          engagement_score?: number | null;
          lead_id?: string | null;
          moved_at?: string | null;
          new_assigned_to?: string | null;
          new_nome?: string | null;
          old_assigned_to?: string | null;
          old_status?: Database['public']['Enums']['lead_status'] | null;
          org_id?: string | null;
        };
        Update: {
          engagement_score?: number | null;
          lead_id?: string | null;
          moved_at?: string | null;
          new_assigned_to?: string | null;
          new_nome?: string | null;
          old_assigned_to?: string | null;
          old_status?: Database['public']['Enums']['lead_status'] | null;
          org_id?: string | null;
        };
        Relationships: [];
      };
      _bkp_julio_calls_reconcile_20260910: {
        Row: {
          answered_at: string | null;
          connected: boolean | null;
          contact_id: string | null;
          cost: number | null;
          created_at: string | null;
          destination: string | null;
          duration_seconds: number | null;
          hangup_cause: string | null;
          id: string | null;
          is_important: boolean | null;
          lead_id: string | null;
          metadata: Json | null;
          notes: string | null;
          org_id: string | null;
          origin: string | null;
          recording_storage_path: string | null;
          recording_url: string | null;
          sdr_disposition: Database['public']['Enums']['call_disposition'] | null;
          sdr_outcome: Database['public']['Enums']['call_status'] | null;
          started_at: string | null;
          status: Database['public']['Enums']['call_status'] | null;
          transcription: string | null;
          transcription_error: string | null;
          transcription_status: string | null;
          type: Database['public']['Enums']['call_type'] | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          answered_at?: string | null;
          connected?: boolean | null;
          contact_id?: string | null;
          cost?: number | null;
          created_at?: string | null;
          destination?: string | null;
          duration_seconds?: number | null;
          hangup_cause?: string | null;
          id?: string | null;
          is_important?: boolean | null;
          lead_id?: string | null;
          metadata?: Json | null;
          notes?: string | null;
          org_id?: string | null;
          origin?: string | null;
          recording_storage_path?: string | null;
          recording_url?: string | null;
          sdr_disposition?: Database['public']['Enums']['call_disposition'] | null;
          sdr_outcome?: Database['public']['Enums']['call_status'] | null;
          started_at?: string | null;
          status?: Database['public']['Enums']['call_status'] | null;
          transcription?: string | null;
          transcription_error?: string | null;
          transcription_status?: string | null;
          type?: Database['public']['Enums']['call_type'] | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          answered_at?: string | null;
          connected?: boolean | null;
          contact_id?: string | null;
          cost?: number | null;
          created_at?: string | null;
          destination?: string | null;
          duration_seconds?: number | null;
          hangup_cause?: string | null;
          id?: string | null;
          is_important?: boolean | null;
          lead_id?: string | null;
          metadata?: Json | null;
          notes?: string | null;
          org_id?: string | null;
          origin?: string | null;
          recording_storage_path?: string | null;
          recording_url?: string | null;
          sdr_disposition?: Database['public']['Enums']['call_disposition'] | null;
          sdr_outcome?: Database['public']['Enums']['call_status'] | null;
          started_at?: string | null;
          status?: Database['public']['Enums']['call_status'] | null;
          transcription?: string | null;
          transcription_error?: string | null;
          transcription_status?: string | null;
          type?: Database['public']['Enums']['call_type'] | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      _bkp_lead_contacts_backfill_allchannels_20260813: {
        Row: {
          contact_id: string;
          inserted_at: string;
          lead_id: string;
        };
        Insert: {
          contact_id: string;
          inserted_at?: string;
          lead_id: string;
        };
        Update: {
          contact_id?: string;
          inserted_at?: string;
          lead_id?: string;
        };
        Relationships: [];
      };
      _bkp_lead_contacts_inbound_backfill_20260813: {
        Row: {
          contact_id: string;
          inserted_at: string;
          lead_id: string;
        };
        Insert: {
          contact_id: string;
          inserted_at?: string;
          lead_id: string;
        };
        Update: {
          contact_id?: string;
          inserted_at?: string;
          lead_id?: string;
        };
        Relationships: [];
      };
      _bkp_next_step_due_9h_20260905: {
        Row: {
          applied_at: string | null;
          cadence_id: string | null;
          current_step: number | null;
          enrollment_id: string | null;
          lead_id: string | null;
          new_next_step_due: string | null;
          old_next_step_due: string | null;
        };
        Insert: {
          applied_at?: string | null;
          cadence_id?: string | null;
          current_step?: number | null;
          enrollment_id?: string | null;
          lead_id?: string | null;
          new_next_step_due?: string | null;
          old_next_step_due?: string | null;
        };
        Update: {
          applied_at?: string | null;
          cadence_id?: string | null;
          current_step?: number | null;
          enrollment_id?: string | null;
          lead_id?: string | null;
          new_next_step_due?: string | null;
          old_next_step_due?: string | null;
        };
        Relationships: [];
      };
      _bkp_pensenova_meeting_starts_20260909: {
        Row: {
          ai_generated: boolean | null;
          backup_em: string | null;
          cadence_id: string | null;
          channel: Database['public']['Enums']['channel_type'] | null;
          contact_id: string | null;
          created_at: string | null;
          external_id: string | null;
          id: string | null;
          lead_id: string | null;
          lead_meeting_held_at_antes: string | null;
          lead_meeting_starts_at_antes: string | null;
          message_content: string | null;
          metadata: Json | null;
          org_id: string | null;
          original_template_id: string | null;
          performed_by: string | null;
          step_id: string | null;
          type: Database['public']['Enums']['interaction_type'] | null;
        };
        Insert: {
          ai_generated?: boolean | null;
          backup_em?: string | null;
          cadence_id?: string | null;
          channel?: Database['public']['Enums']['channel_type'] | null;
          contact_id?: string | null;
          created_at?: string | null;
          external_id?: string | null;
          id?: string | null;
          lead_id?: string | null;
          lead_meeting_held_at_antes?: string | null;
          lead_meeting_starts_at_antes?: string | null;
          message_content?: string | null;
          metadata?: Json | null;
          org_id?: string | null;
          original_template_id?: string | null;
          performed_by?: string | null;
          step_id?: string | null;
          type?: Database['public']['Enums']['interaction_type'] | null;
        };
        Update: {
          ai_generated?: boolean | null;
          backup_em?: string | null;
          cadence_id?: string | null;
          channel?: Database['public']['Enums']['channel_type'] | null;
          contact_id?: string | null;
          created_at?: string | null;
          external_id?: string | null;
          id?: string | null;
          lead_id?: string | null;
          lead_meeting_held_at_antes?: string | null;
          lead_meeting_starts_at_antes?: string | null;
          message_content?: string | null;
          metadata?: Json | null;
          org_id?: string | null;
          original_template_id?: string | null;
          performed_by?: string | null;
          step_id?: string | null;
          type?: Database['public']['Enums']['interaction_type'] | null;
        };
        Relationships: [];
      };
      _bkp_phones_str_contacts_20260813: {
        Row: {
          emails: Json | null;
          id: string | null;
          lead_id: string | null;
          phones: Json | null;
          updated_at: string | null;
        };
        Insert: {
          emails?: Json | null;
          id?: string | null;
          lead_id?: string | null;
          phones?: Json | null;
          updated_at?: string | null;
        };
        Update: {
          emails?: Json | null;
          id?: string | null;
          lead_id?: string | null;
          phones?: Json | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      _bkp_phones_str_leads_20260813: {
        Row: {
          email: string | null;
          email_bounced_at: string | null;
          emails: Json | null;
          id: string | null;
          phones: Json | null;
          telefone: string | null;
          updated_at: string | null;
          whatsapp_invalid_at: string | null;
        };
        Insert: {
          email?: string | null;
          email_bounced_at?: string | null;
          emails?: Json | null;
          id?: string | null;
          phones?: Json | null;
          telefone?: string | null;
          updated_at?: string | null;
          whatsapp_invalid_at?: string | null;
        };
        Update: {
          email?: string | null;
          email_bounced_at?: string | null;
          emails?: Json | null;
          id?: string | null;
          phones?: Json | null;
          telefone?: string | null;
          updated_at?: string | null;
          whatsapp_invalid_at?: string | null;
        };
        Relationships: [];
      };
      _bkp_recovery_cut_enrollments_20260818: {
        Row: {
          cadence_id: string | null;
          completed_at: string | null;
          current_step: number | null;
          enrolled_at: string | null;
          enrolled_by: string | null;
          id: string | null;
          lead_id: string | null;
          loss_notes: string | null;
          loss_reason_id: string | null;
          next_step_due: string | null;
          org_id: string | null;
          scheduled_start_at: string | null;
          status: Database['public']['Enums']['enrollment_status'] | null;
          updated_at: string | null;
        };
        Insert: {
          cadence_id?: string | null;
          completed_at?: string | null;
          current_step?: number | null;
          enrolled_at?: string | null;
          enrolled_by?: string | null;
          id?: string | null;
          lead_id?: string | null;
          loss_notes?: string | null;
          loss_reason_id?: string | null;
          next_step_due?: string | null;
          org_id?: string | null;
          scheduled_start_at?: string | null;
          status?: Database['public']['Enums']['enrollment_status'] | null;
          updated_at?: string | null;
        };
        Update: {
          cadence_id?: string | null;
          completed_at?: string | null;
          current_step?: number | null;
          enrolled_at?: string | null;
          enrolled_by?: string | null;
          id?: string | null;
          lead_id?: string | null;
          loss_notes?: string | null;
          loss_reason_id?: string | null;
          next_step_due?: string | null;
          org_id?: string | null;
          scheduled_start_at?: string | null;
          status?: Database['public']['Enums']['enrollment_status'] | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      _bkp_recovery_cut_steps_20260818: {
        Row: {
          ab_distribution: number | null;
          ab_enabled: boolean | null;
          ab_enabled_at: string | null;
          ab_winner_at: string | null;
          ab_winner_variant: string | null;
          activity_name: string | null;
          ai_personalization: boolean | null;
          cadence_id: string | null;
          call_provider: string | null;
          channel: Database['public']['Enums']['channel_type'] | null;
          created_at: string | null;
          delay_days: number | null;
          delay_hours: number | null;
          id: string | null;
          instructions: string | null;
          reply_type: string | null;
          step_order: number | null;
          template_id: string | null;
          template_id_b: string | null;
        };
        Insert: {
          ab_distribution?: number | null;
          ab_enabled?: boolean | null;
          ab_enabled_at?: string | null;
          ab_winner_at?: string | null;
          ab_winner_variant?: string | null;
          activity_name?: string | null;
          ai_personalization?: boolean | null;
          cadence_id?: string | null;
          call_provider?: string | null;
          channel?: Database['public']['Enums']['channel_type'] | null;
          created_at?: string | null;
          delay_days?: number | null;
          delay_hours?: number | null;
          id?: string | null;
          instructions?: string | null;
          reply_type?: string | null;
          step_order?: number | null;
          template_id?: string | null;
          template_id_b?: string | null;
        };
        Update: {
          ab_distribution?: number | null;
          ab_enabled?: boolean | null;
          ab_enabled_at?: string | null;
          ab_winner_at?: string | null;
          ab_winner_variant?: string | null;
          activity_name?: string | null;
          ai_personalization?: boolean | null;
          cadence_id?: string | null;
          call_provider?: string | null;
          channel?: Database['public']['Enums']['channel_type'] | null;
          created_at?: string | null;
          delay_days?: number | null;
          delay_hours?: number | null;
          id?: string | null;
          instructions?: string | null;
          reply_type?: string | null;
          step_order?: number | null;
          template_id?: string | null;
          template_id_b?: string | null;
        };
        Relationships: [];
      };
      _bkp_recovery_realign_20260904: {
        Row: {
          applied_at: string | null;
          enrollment_id: string | null;
          kind: string | null;
          lead_id: string | null;
          new_current_step: number | null;
          old_current_step: number | null;
          old_next_step_due: string | null;
          status: Database['public']['Enums']['enrollment_status'] | null;
        };
        Insert: {
          applied_at?: string | null;
          enrollment_id?: string | null;
          kind?: string | null;
          lead_id?: string | null;
          new_current_step?: number | null;
          old_current_step?: number | null;
          old_next_step_due?: string | null;
          status?: Database['public']['Enums']['enrollment_status'] | null;
        };
        Update: {
          applied_at?: string | null;
          enrollment_id?: string | null;
          kind?: string | null;
          lead_id?: string | null;
          new_current_step?: number | null;
          old_current_step?: number | null;
          old_next_step_due?: string | null;
          status?: Database['public']['Enums']['enrollment_status'] | null;
        };
        Relationships: [];
      };
      _bkp_recovery_relink_enr_20260903: {
        Row: {
          applied_at: string | null;
          assigned_to: string | null;
          cs_remapped: boolean | null;
          enrollment_id: string;
          lead_id: string | null;
          new_current_step: number | null;
          next_step_due: string | null;
          old_current_step: number | null;
        };
        Insert: {
          applied_at?: string | null;
          assigned_to?: string | null;
          cs_remapped?: boolean | null;
          enrollment_id: string;
          lead_id?: string | null;
          new_current_step?: number | null;
          next_step_due?: string | null;
          old_current_step?: number | null;
        };
        Update: {
          applied_at?: string | null;
          assigned_to?: string | null;
          cs_remapped?: boolean | null;
          enrollment_id?: string;
          lead_id?: string | null;
          new_current_step?: number | null;
          next_step_due?: string | null;
          old_current_step?: number | null;
        };
        Relationships: [];
      };
      _bkp_recovery_relink_ix_20260903: {
        Row: {
          applied_at: string | null;
          enrollment_id: string | null;
          interaction_id: string;
          kind: string | null;
          new_step_id: string | null;
        };
        Insert: {
          applied_at?: string | null;
          enrollment_id?: string | null;
          interaction_id: string;
          kind?: string | null;
          new_step_id?: string | null;
        };
        Update: {
          applied_at?: string | null;
          enrollment_id?: string | null;
          interaction_id?: string;
          kind?: string | null;
          new_step_id?: string | null;
        };
        Relationships: [];
      };
      _bkp_recovery_resume_guilherme_20260904: {
        Row: {
          applied_at: string | null;
          enrollment_id: string | null;
          kind: string | null;
          lead_id: string | null;
          new_current_step: number | null;
          old_current_step: number | null;
          old_next_step_due: string | null;
          old_status: Database['public']['Enums']['enrollment_status'] | null;
          old_updated_at: string | null;
          wa_invalido: boolean | null;
        };
        Insert: {
          applied_at?: string | null;
          enrollment_id?: string | null;
          kind?: string | null;
          lead_id?: string | null;
          new_current_step?: number | null;
          old_current_step?: number | null;
          old_next_step_due?: string | null;
          old_status?: Database['public']['Enums']['enrollment_status'] | null;
          old_updated_at?: string | null;
          wa_invalido?: boolean | null;
        };
        Update: {
          applied_at?: string | null;
          enrollment_id?: string | null;
          kind?: string | null;
          lead_id?: string | null;
          new_current_step?: number | null;
          old_current_step?: number | null;
          old_next_step_due?: string | null;
          old_status?: Database['public']['Enums']['enrollment_status'] | null;
          old_updated_at?: string | null;
          wa_invalido?: boolean | null;
        };
        Relationships: [];
      };
      _bkp_recovery_spread_guilherme_20260904: {
        Row: {
          applied_at: string | null;
          current_step: number | null;
          enrollment_id: string | null;
          lead_id: string | null;
          new_next_step_due: string | null;
          old_next_step_due: string | null;
        };
        Insert: {
          applied_at?: string | null;
          current_step?: number | null;
          enrollment_id?: string | null;
          lead_id?: string | null;
          new_next_step_due?: string | null;
          old_next_step_due?: string | null;
        };
        Update: {
          applied_at?: string | null;
          current_step?: number | null;
          enrollment_id?: string | null;
          lead_id?: string | null;
          new_next_step_due?: string | null;
          old_next_step_due?: string | null;
        };
        Relationships: [];
      };
      _bkp_recovery_spread2_guilherme_20260904: {
        Row: {
          applied_at: string | null;
          current_step: number | null;
          enrollment_id: string | null;
          lead_id: string | null;
          new_next_step_due: string | null;
          old_next_step_due: string | null;
        };
        Insert: {
          applied_at?: string | null;
          current_step?: number | null;
          enrollment_id?: string | null;
          lead_id?: string | null;
          new_next_step_due?: string | null;
          old_next_step_due?: string | null;
        };
        Update: {
          applied_at?: string | null;
          current_step?: number | null;
          enrollment_id?: string | null;
          lead_id?: string | null;
          new_next_step_due?: string | null;
          old_next_step_due?: string | null;
        };
        Relationships: [];
      };
      _bkp_revert_recovery_30d_20260901: {
        Row: {
          assigned_no_momento_do_revert: string | null;
          backed_up_at: string | null;
          enrolled_at: string | null;
          enrollment_id: string | null;
          enrollment_status: Database['public']['Enums']['enrollment_status'] | null;
          lead_id: string | null;
          lost_at: string | null;
          motivo: string | null;
          new_assigned_to: string | null;
          prev_assigned_to: string | null;
          scheduled_start_at: string | null;
        };
        Insert: {
          assigned_no_momento_do_revert?: string | null;
          backed_up_at?: string | null;
          enrolled_at?: string | null;
          enrollment_id?: string | null;
          enrollment_status?: Database['public']['Enums']['enrollment_status'] | null;
          lead_id?: string | null;
          lost_at?: string | null;
          motivo?: string | null;
          new_assigned_to?: string | null;
          prev_assigned_to?: string | null;
          scheduled_start_at?: string | null;
        };
        Update: {
          assigned_no_momento_do_revert?: string | null;
          backed_up_at?: string | null;
          enrolled_at?: string | null;
          enrollment_id?: string | null;
          enrollment_status?: Database['public']['Enums']['enrollment_status'] | null;
          lead_id?: string | null;
          lost_at?: string | null;
          motivo?: string | null;
          new_assigned_to?: string | null;
          prev_assigned_to?: string | null;
          scheduled_start_at?: string | null;
        };
        Relationships: [];
      };
      activity_templates: {
        Row: {
          channel: Database['public']['Enums']['channel_type'];
          created_at: string;
          created_by: string | null;
          id: string;
          instructions: string;
          name: string;
          org_id: string;
          updated_at: string;
        };
        Insert: {
          channel: Database['public']['Enums']['channel_type'];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          instructions?: string;
          name: string;
          org_id: string;
          updated_at?: string;
        };
        Update: {
          channel?: Database['public']['Enums']['channel_type'];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          instructions?: string;
          name?: string;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'activity_templates_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      activity_type_variations: {
        Row: {
          call_provider: string | null;
          channel: Database['public']['Enums']['channel_type'];
          created_at: string;
          id: string;
          label: string;
          org_id: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          call_provider?: string | null;
          channel: Database['public']['Enums']['channel_type'];
          created_at?: string;
          id?: string;
          label: string;
          org_id: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          call_provider?: string | null;
          channel?: Database['public']['Enums']['channel_type'];
          created_at?: string;
          id?: string;
          label?: string;
          org_id?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'activity_type_variations_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_usage: {
        Row: {
          daily_limit: number;
          generation_count: number;
          id: string;
          org_id: string;
          tokens_used: number;
          usage_date: string;
        };
        Insert: {
          daily_limit: number;
          generation_count?: number;
          id?: string;
          org_id: string;
          tokens_used?: number;
          usage_date?: string;
        };
        Update: {
          daily_limit?: number;
          generation_count?: number;
          id?: string;
          org_id?: string;
          tokens_used?: number;
          usage_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_usage_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      api_keys: {
        Row: {
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          id: string;
          is_active: boolean;
          key_hash: string;
          key_prefix: string;
          last_used_at: string | null;
          name: string;
          org_id: string;
          scopes: string[];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean;
          key_hash: string;
          key_prefix: string;
          last_used_at?: string | null;
          name: string;
          org_id: string;
          scopes?: string[];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean;
          key_hash?: string;
          key_prefix?: string;
          last_used_at?: string | null;
          name?: string;
          org_id?: string;
          scopes?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'api_keys_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      api_secrets: {
        Row: {
          created_at: string;
          name: string;
          revoked_at: string | null;
          token_hash: string;
        };
        Insert: {
          created_at?: string;
          name: string;
          revoked_at?: string | null;
          token_hash: string;
        };
        Update: {
          created_at?: string;
          name?: string;
          revoked_at?: string | null;
          token_hash?: string;
        };
        Relationships: [];
      };
      api4com_connections: {
        Row: {
          api_key_encrypted: string | null;
          base_url: string;
          created_at: string;
          id: string;
          org_id: string;
          ramal: string;
          sip_domain: string | null;
          sip_password_encrypted: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          api_key_encrypted?: string | null;
          base_url?: string;
          created_at?: string;
          id?: string;
          org_id: string;
          ramal: string;
          sip_domain?: string | null;
          sip_password_encrypted?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          api_key_encrypted?: string | null;
          base_url?: string;
          created_at?: string;
          id?: string;
          org_id?: string;
          ramal?: string;
          sip_domain?: string | null;
          sip_password_encrypted?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'api4com_connections_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      apollo_connections: {
        Row: {
          api_key_encrypted: string;
          created_at: string;
          id: string;
          org_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          api_key_encrypted: string;
          created_at?: string;
          id?: string;
          org_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          api_key_encrypted?: string;
          created_at?: string;
          id?: string;
          org_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'apollo_connections_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: true;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      apollo_export_perdidos_20260905: {
        Row: {
          apollo_contact_id: string | null;
          email: string | null;
          empresa: string | null;
          exported_at: string | null;
          first_name: string | null;
          job_title: string | null;
          last_name: string | null;
          lead_id: string | null;
          lote: number | null;
          motivo: string | null;
          rn: number | null;
          telefone: string | null;
          website: string | null;
        };
        Insert: {
          apollo_contact_id?: string | null;
          email?: string | null;
          empresa?: string | null;
          exported_at?: string | null;
          first_name?: string | null;
          job_title?: string | null;
          last_name?: string | null;
          lead_id?: string | null;
          lote?: number | null;
          motivo?: string | null;
          rn?: number | null;
          telefone?: string | null;
          website?: string | null;
        };
        Update: {
          apollo_contact_id?: string | null;
          email?: string | null;
          empresa?: string | null;
          exported_at?: string | null;
          first_name?: string | null;
          job_title?: string | null;
          last_name?: string | null;
          lead_id?: string | null;
          lote?: number | null;
          motivo?: string | null;
          rn?: number | null;
          telefone?: string | null;
          website?: string | null;
        };
        Relationships: [];
      };
      apollo_saved_searches: {
        Row: {
          created_at: string;
          filters: Json;
          id: string;
          name: string;
          org_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          filters?: Json;
          id?: string;
          name: string;
          org_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          filters?: Json;
          id?: string;
          name?: string;
          org_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'apollo_saved_searches_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      app_flags: {
        Row: {
          enabled: boolean;
          key: string;
          note: string | null;
          updated_at: string;
        };
        Insert: {
          enabled?: boolean;
          key: string;
          note?: string | null;
          updated_at?: string;
        };
        Update: {
          enabled?: boolean;
          key?: string;
          note?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          action: string;
          created_at: string;
          id: string;
          ip_address: string | null;
          metadata: Json | null;
          org_id: string;
          resource_id: string | null;
          resource_type: string;
          user_id: string | null;
        };
        Insert: {
          action: string;
          created_at?: string;
          id?: string;
          ip_address?: string | null;
          metadata?: Json | null;
          org_id: string;
          resource_id?: string | null;
          resource_type: string;
          user_id?: string | null;
        };
        Update: {
          action?: string;
          created_at?: string;
          id?: string;
          ip_address?: string | null;
          metadata?: Json | null;
          org_id?: string;
          resource_id?: string | null;
          resource_type?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      cadence_enrollments: {
        Row: {
          cadence_id: string;
          completed_at: string | null;
          current_step: number;
          enrolled_at: string;
          enrolled_by: string | null;
          id: string;
          lead_id: string;
          loss_notes: string | null;
          loss_reason_id: string | null;
          next_step_due: string | null;
          org_id: string;
          pending_assigned_to: string | null;
          scheduled_start_at: string | null;
          snooze_count: number;
          status: Database['public']['Enums']['enrollment_status'];
          updated_at: string;
        };
        Insert: {
          cadence_id: string;
          completed_at?: string | null;
          current_step?: number;
          enrolled_at?: string;
          enrolled_by?: string | null;
          id?: string;
          lead_id: string;
          loss_notes?: string | null;
          loss_reason_id?: string | null;
          next_step_due?: string | null;
          org_id: string;
          pending_assigned_to?: string | null;
          scheduled_start_at?: string | null;
          snooze_count?: number;
          status?: Database['public']['Enums']['enrollment_status'];
          updated_at?: string;
        };
        Update: {
          cadence_id?: string;
          completed_at?: string | null;
          current_step?: number;
          enrolled_at?: string;
          enrolled_by?: string | null;
          id?: string;
          lead_id?: string;
          loss_notes?: string | null;
          loss_reason_id?: string | null;
          next_step_due?: string | null;
          org_id?: string;
          pending_assigned_to?: string | null;
          scheduled_start_at?: string | null;
          snooze_count?: number;
          status?: Database['public']['Enums']['enrollment_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cadence_enrollments_cadence_id_fkey';
            columns: ['cadence_id'];
            isOneToOne: false;
            referencedRelation: 'cadences';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cadence_enrollments_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cadence_enrollments_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads_no_active_enrollment';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cadence_enrollments_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_leads_cadence_limbo';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cadence_enrollments_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_meeting_webhook_candidates';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'cadence_enrollments_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_reminders_due';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'cadence_enrollments_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'vw_callface_reciclagem';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'cadence_enrollments_loss_reason_id_fkey';
            columns: ['loss_reason_id'];
            isOneToOne: false;
            referencedRelation: 'loss_reasons';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cadence_enrollments_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      cadence_steps: {
        Row: {
          ab_distribution: number;
          ab_enabled: boolean;
          ab_enabled_at: string | null;
          ab_winner_at: string | null;
          ab_winner_variant: string | null;
          activity_name: string | null;
          ai_personalization: boolean;
          cadence_id: string;
          call_provider: string | null;
          channel: Database['public']['Enums']['channel_type'];
          created_at: string;
          delay_days: number;
          delay_hours: number;
          id: string;
          instructions: string | null;
          reply_type: string;
          step_order: number;
          template_id: string | null;
          template_id_b: string | null;
        };
        Insert: {
          ab_distribution?: number;
          ab_enabled?: boolean;
          ab_enabled_at?: string | null;
          ab_winner_at?: string | null;
          ab_winner_variant?: string | null;
          activity_name?: string | null;
          ai_personalization?: boolean;
          cadence_id: string;
          call_provider?: string | null;
          channel: Database['public']['Enums']['channel_type'];
          created_at?: string;
          delay_days?: number;
          delay_hours?: number;
          id?: string;
          instructions?: string | null;
          reply_type?: string;
          step_order: number;
          template_id?: string | null;
          template_id_b?: string | null;
        };
        Update: {
          ab_distribution?: number;
          ab_enabled?: boolean;
          ab_enabled_at?: string | null;
          ab_winner_at?: string | null;
          ab_winner_variant?: string | null;
          activity_name?: string | null;
          ai_personalization?: boolean;
          cadence_id?: string;
          call_provider?: string | null;
          channel?: Database['public']['Enums']['channel_type'];
          created_at?: string;
          delay_days?: number;
          delay_hours?: number;
          id?: string;
          instructions?: string | null;
          reply_type?: string;
          step_order?: number;
          template_id?: string | null;
          template_id_b?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'cadence_steps_cadence_id_fkey';
            columns: ['cadence_id'];
            isOneToOne: false;
            referencedRelation: 'cadences';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cadence_steps_template_id_b_fkey';
            columns: ['template_id_b'];
            isOneToOne: false;
            referencedRelation: 'message_templates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cadence_steps_template_id_fkey';
            columns: ['template_id'];
            isOneToOne: false;
            referencedRelation: 'message_templates';
            referencedColumns: ['id'];
          },
        ];
      };
      cadences: {
        Row: {
          auto_loss_after_days: number | null;
          auto_loss_reason_id: string | null;
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          description: string | null;
          id: string;
          name: string;
          org_id: string;
          origin: string;
          priority: string;
          sdr_switch_allowed: boolean;
          status: Database['public']['Enums']['cadence_status'];
          total_steps: number;
          type: string;
          updated_at: string;
        };
        Insert: {
          auto_loss_after_days?: number | null;
          auto_loss_reason_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          name: string;
          org_id: string;
          origin?: string;
          priority?: string;
          sdr_switch_allowed?: boolean;
          status?: Database['public']['Enums']['cadence_status'];
          total_steps?: number;
          type?: string;
          updated_at?: string;
        };
        Update: {
          auto_loss_after_days?: number | null;
          auto_loss_reason_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          name?: string;
          org_id?: string;
          origin?: string;
          priority?: string;
          sdr_switch_allowed?: boolean;
          status?: Database['public']['Enums']['cadence_status'];
          total_steps?: number;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cadences_auto_loss_reason_id_fkey';
            columns: ['auto_loss_reason_id'];
            isOneToOne: false;
            referencedRelation: 'loss_reasons';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cadences_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      calendar_connections: {
        Row: {
          access_token_encrypted: string;
          calendar_email: string;
          created_at: string;
          id: string;
          org_id: string;
          refresh_token_encrypted: string;
          status: Database['public']['Enums']['connection_status'];
          token_expires_at: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          access_token_encrypted: string;
          calendar_email: string;
          created_at?: string;
          id?: string;
          org_id: string;
          refresh_token_encrypted: string;
          status?: Database['public']['Enums']['connection_status'];
          token_expires_at: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          access_token_encrypted?: string;
          calendar_email?: string;
          created_at?: string;
          id?: string;
          org_id?: string;
          refresh_token_encrypted?: string;
          status?: Database['public']['Enums']['connection_status'];
          token_expires_at?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'calendar_connections_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      call_daily_targets: {
        Row: {
          created_at: string;
          daily_target: number;
          id: string;
          org_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          daily_target?: number;
          id?: string;
          org_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          daily_target?: number;
          id?: string;
          org_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'call_daily_targets_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      call_feedback: {
        Row: {
          call_id: string;
          content: string;
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          call_id: string;
          content: string;
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          call_id?: string;
          content?: string;
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'call_feedback_call_id_fkey';
            columns: ['call_id'];
            isOneToOne: false;
            referencedRelation: 'calls';
            referencedColumns: ['id'];
          },
        ];
      };
      callface_events: {
        Row: {
          call_id: string | null;
          id: string;
          lead_matched: boolean | null;
          ok: boolean | null;
          payload: Json;
          reason: string | null;
          received_at: string;
          result: Json | null;
        };
        Insert: {
          call_id?: string | null;
          id?: string;
          lead_matched?: boolean | null;
          ok?: boolean | null;
          payload: Json;
          reason?: string | null;
          received_at?: string;
          result?: Json | null;
        };
        Update: {
          call_id?: string | null;
          id?: string;
          lead_matched?: boolean | null;
          ok?: boolean | null;
          payload?: Json;
          reason?: string | null;
          received_at?: string;
          result?: Json | null;
        };
        Relationships: [];
      };
      calls: {
        Row: {
          answered_at: string | null;
          connected: boolean;
          contact_id: string | null;
          cost: number | null;
          created_at: string;
          destination: string;
          duration_seconds: number;
          hangup_cause: string | null;
          id: string;
          is_important: boolean;
          lead_id: string | null;
          metadata: Json | null;
          notes: string | null;
          org_id: string;
          origin: string;
          recording_storage_path: string | null;
          recording_url: string | null;
          sdr_disposition: Database['public']['Enums']['call_disposition'] | null;
          sdr_outcome: Database['public']['Enums']['call_status'] | null;
          started_at: string;
          status: Database['public']['Enums']['call_status'];
          transcription: string | null;
          transcription_error: string | null;
          transcription_status: string | null;
          type: Database['public']['Enums']['call_type'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          answered_at?: string | null;
          connected?: boolean;
          contact_id?: string | null;
          cost?: number | null;
          created_at?: string;
          destination: string;
          duration_seconds?: number;
          hangup_cause?: string | null;
          id?: string;
          is_important?: boolean;
          lead_id?: string | null;
          metadata?: Json | null;
          notes?: string | null;
          org_id: string;
          origin: string;
          recording_storage_path?: string | null;
          recording_url?: string | null;
          sdr_disposition?: Database['public']['Enums']['call_disposition'] | null;
          sdr_outcome?: Database['public']['Enums']['call_status'] | null;
          started_at?: string;
          status?: Database['public']['Enums']['call_status'];
          transcription?: string | null;
          transcription_error?: string | null;
          transcription_status?: string | null;
          type?: Database['public']['Enums']['call_type'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          answered_at?: string | null;
          connected?: boolean;
          contact_id?: string | null;
          cost?: number | null;
          created_at?: string;
          destination?: string;
          duration_seconds?: number;
          hangup_cause?: string | null;
          id?: string;
          is_important?: boolean;
          lead_id?: string | null;
          metadata?: Json | null;
          notes?: string | null;
          org_id?: string;
          origin?: string;
          recording_storage_path?: string | null;
          recording_url?: string | null;
          sdr_disposition?: Database['public']['Enums']['call_disposition'] | null;
          sdr_outcome?: Database['public']['Enums']['call_status'] | null;
          started_at?: string;
          status?: Database['public']['Enums']['call_status'];
          transcription?: string | null;
          transcription_error?: string | null;
          transcription_status?: string | null;
          type?: Database['public']['Enums']['call_type'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'calls_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'lead_contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calls_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calls_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads_no_active_enrollment';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calls_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_leads_cadence_limbo';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calls_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_meeting_webhook_candidates';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'calls_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_reminders_due';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'calls_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'vw_callface_reciclagem';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'calls_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      closer_feedback_requests: {
        Row: {
          closer_id: string;
          comment: string | null;
          created_at: string;
          decisor_presente: boolean | null;
          divergencias: string[] | null;
          expires_at: string;
          id: string;
          lead_id: string;
          oportunidade_qualificada: boolean | null;
          org_id: string;
          qualificacao_aderente:
            | Database['public']['Enums']['closer_qualificacao_aderencia']
            | null;
          rating: number | null;
          reminder_count: number;
          reminder_sent_at: string | null;
          responded_at: string | null;
          result: Database['public']['Enums']['closer_feedback_result'] | null;
          sent_at: string;
          token: string;
          updated_at: string;
        };
        Insert: {
          closer_id: string;
          comment?: string | null;
          created_at?: string;
          decisor_presente?: boolean | null;
          divergencias?: string[] | null;
          expires_at?: string;
          id?: string;
          lead_id: string;
          oportunidade_qualificada?: boolean | null;
          org_id: string;
          qualificacao_aderente?:
            | Database['public']['Enums']['closer_qualificacao_aderencia']
            | null;
          rating?: number | null;
          reminder_count?: number;
          reminder_sent_at?: string | null;
          responded_at?: string | null;
          result?: Database['public']['Enums']['closer_feedback_result'] | null;
          sent_at?: string;
          token?: string;
          updated_at?: string;
        };
        Update: {
          closer_id?: string;
          comment?: string | null;
          created_at?: string;
          decisor_presente?: boolean | null;
          divergencias?: string[] | null;
          expires_at?: string;
          id?: string;
          lead_id?: string;
          oportunidade_qualificada?: boolean | null;
          org_id?: string;
          qualificacao_aderente?:
            | Database['public']['Enums']['closer_qualificacao_aderencia']
            | null;
          rating?: number | null;
          reminder_count?: number;
          reminder_sent_at?: string | null;
          responded_at?: string | null;
          result?: Database['public']['Enums']['closer_feedback_result'] | null;
          sent_at?: string;
          token?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'closer_feedback_requests_closer_id_fkey';
            columns: ['closer_id'];
            isOneToOne: false;
            referencedRelation: 'closers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'closer_feedback_requests_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'closer_feedback_requests_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads_no_active_enrollment';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'closer_feedback_requests_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_leads_cadence_limbo';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'closer_feedback_requests_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_meeting_webhook_candidates';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'closer_feedback_requests_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_reminders_due';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'closer_feedback_requests_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'vw_callface_reciclagem';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'closer_feedback_requests_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      closers: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          email: string;
          id: string;
          name: string;
          org_id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          email: string;
          id?: string;
          name: string;
          org_id: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          email?: string;
          id?: string;
          name?: string;
          org_id?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'closers_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      confirmacoes_reuniao: {
        Row: {
          atualizado_em: string;
          calendar_id: string | null;
          confirmado_at: string | null;
          criado_em: string;
          enviado_d1_at: string | null;
          enviado_dia_at: string | null;
          event_id: string | null;
          id: number;
          lead_id: string | null;
          ligacao_enviada_at: string | null;
          ligacao_resultado: string | null;
          ligacao_tentativas: number;
          link_reuniao: string | null;
          nome: string | null;
          reagendou_at: string | null;
          responsavel: string | null;
          reuniao_em: string;
          sdr: string | null;
          status_d1: string | null;
          status_dia: string | null;
          telefone: string;
          ultimo_erro: string | null;
          wamid_d1: string | null;
          wamid_dia: string | null;
        };
        Insert: {
          atualizado_em?: string;
          calendar_id?: string | null;
          confirmado_at?: string | null;
          criado_em?: string;
          enviado_d1_at?: string | null;
          enviado_dia_at?: string | null;
          event_id?: string | null;
          id?: number;
          lead_id?: string | null;
          ligacao_enviada_at?: string | null;
          ligacao_resultado?: string | null;
          ligacao_tentativas?: number;
          link_reuniao?: string | null;
          nome?: string | null;
          reagendou_at?: string | null;
          responsavel?: string | null;
          reuniao_em: string;
          sdr?: string | null;
          status_d1?: string | null;
          status_dia?: string | null;
          telefone: string;
          ultimo_erro?: string | null;
          wamid_d1?: string | null;
          wamid_dia?: string | null;
        };
        Update: {
          atualizado_em?: string;
          calendar_id?: string | null;
          confirmado_at?: string | null;
          criado_em?: string;
          enviado_d1_at?: string | null;
          enviado_dia_at?: string | null;
          event_id?: string | null;
          id?: number;
          lead_id?: string | null;
          ligacao_enviada_at?: string | null;
          ligacao_resultado?: string | null;
          ligacao_tentativas?: number;
          link_reuniao?: string | null;
          nome?: string | null;
          reagendou_at?: string | null;
          responsavel?: string | null;
          reuniao_em?: string;
          sdr?: string | null;
          status_d1?: string | null;
          status_dia?: string | null;
          telefone?: string;
          ultimo_erro?: string | null;
          wamid_d1?: string | null;
          wamid_dia?: string | null;
        };
        Relationships: [];
      };
      copiloto_app_users: {
        Row: {
          active: boolean;
          created_at: string;
          email: string;
          name: string | null;
          user_id: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          email: string;
          name?: string | null;
          user_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          email?: string;
          name?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      copiloto_call_sessions: {
        Row: {
          created_at: string;
          ended_at: string | null;
          id: string;
          lead_briefing: string | null;
          lead_id: string | null;
          local_session_id: string;
          started_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          lead_briefing?: string | null;
          lead_id?: string | null;
          local_session_id: string;
          started_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          lead_briefing?: string | null;
          lead_id?: string | null;
          local_session_id?: string;
          started_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'copiloto_call_sessions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'copiloto_app_users';
            referencedColumns: ['user_id'];
          },
        ];
      };
      copiloto_call_transcripts: {
        Row: {
          call_session_id: string;
          id: number;
          seq: number;
          speaker: string;
          spoken_at: string | null;
          text: string;
        };
        Insert: {
          call_session_id: string;
          id?: never;
          seq: number;
          speaker: string;
          spoken_at?: string | null;
          text: string;
        };
        Update: {
          call_session_id?: string;
          id?: never;
          seq?: number;
          speaker?: string;
          spoken_at?: string | null;
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'copiloto_call_transcripts_call_session_id_fkey';
            columns: ['call_session_id'];
            isOneToOne: false;
            referencedRelation: 'copiloto_call_sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      copiloto_proxy_usage: {
        Row: {
          created_at: string;
          id: number;
          model: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: never;
          model?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          model?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'copiloto_proxy_usage_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'copiloto_app_users';
            referencedColumns: ['user_id'];
          },
        ];
      };
      crm_connections: {
        Row: {
          created_at: string;
          credentials_encrypted: string;
          crm_provider: Database['public']['Enums']['crm_type'];
          default_pipeline_id: string | null;
          default_responsible_user_id: string | null;
          default_stage_id: string | null;
          field_mapping: Json | null;
          id: string;
          last_sync_at: string | null;
          org_id: string;
          status: Database['public']['Enums']['connection_status'];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          credentials_encrypted: string;
          crm_provider: Database['public']['Enums']['crm_type'];
          default_pipeline_id?: string | null;
          default_responsible_user_id?: string | null;
          default_stage_id?: string | null;
          field_mapping?: Json | null;
          id?: string;
          last_sync_at?: string | null;
          org_id: string;
          status?: Database['public']['Enums']['connection_status'];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          credentials_encrypted?: string;
          crm_provider?: Database['public']['Enums']['crm_type'];
          default_pipeline_id?: string | null;
          default_responsible_user_id?: string | null;
          default_stage_id?: string | null;
          field_mapping?: Json | null;
          id?: string;
          last_sync_at?: string | null;
          org_id?: string;
          status?: Database['public']['Enums']['connection_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'crm_connections_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      crm_sync_log: {
        Row: {
          connection_id: string;
          created_at: string;
          direction: Database['public']['Enums']['sync_direction'];
          duration_ms: number | null;
          error_details: Json | null;
          errors: number;
          id: string;
          records_synced: number;
        };
        Insert: {
          connection_id: string;
          created_at?: string;
          direction: Database['public']['Enums']['sync_direction'];
          duration_ms?: number | null;
          error_details?: Json | null;
          errors?: number;
          id?: string;
          records_synced?: number;
        };
        Update: {
          connection_id?: string;
          created_at?: string;
          direction?: Database['public']['Enums']['sync_direction'];
          duration_ms?: number | null;
          error_details?: Json | null;
          errors?: number;
          id?: string;
          records_synced?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'crm_sync_log_connection_id_fkey';
            columns: ['connection_id'];
            isOneToOne: false;
            referencedRelation: 'crm_connections';
            referencedColumns: ['id'];
          },
        ];
      };
      custom_fields: {
        Row: {
          created_at: string;
          field_name: string;
          field_type: string;
          id: string;
          is_required_lost: boolean;
          is_required_meeting: boolean;
          is_required_won: boolean;
          is_visible: boolean;
          options: Json | null;
          org_id: string;
          sort_order: number;
          system_key: string | null;
        };
        Insert: {
          created_at?: string;
          field_name: string;
          field_type: string;
          id?: string;
          is_required_lost?: boolean;
          is_required_meeting?: boolean;
          is_required_won?: boolean;
          is_visible?: boolean;
          options?: Json | null;
          org_id: string;
          sort_order?: number;
          system_key?: string | null;
        };
        Update: {
          created_at?: string;
          field_name?: string;
          field_type?: string;
          id?: string;
          is_required_lost?: boolean;
          is_required_meeting?: boolean;
          is_required_won?: boolean;
          is_visible?: boolean;
          options?: Json | null;
          org_id?: string;
          sort_order?: number;
          system_key?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'custom_fields_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      daily_activity_goals: {
        Row: {
          created_at: string;
          id: string;
          org_id: string;
          target: number;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          org_id: string;
          target?: number;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string;
          target?: number;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'daily_activity_goals_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      dossie_cache: {
        Row: {
          atualizado_em: string | null;
          cnpj: string | null;
          criado_em: string | null;
          dossie: string | null;
          empresa: string | null;
          fatos: Json | null;
          fonte: string | null;
          lead_id: string;
          telefone: string | null;
        };
        Insert: {
          atualizado_em?: string | null;
          cnpj?: string | null;
          criado_em?: string | null;
          dossie?: string | null;
          empresa?: string | null;
          fatos?: Json | null;
          fonte?: string | null;
          lead_id: string;
          telefone?: string | null;
        };
        Update: {
          atualizado_em?: string | null;
          cnpj?: string | null;
          criado_em?: string | null;
          dossie?: string | null;
          empresa?: string | null;
          fatos?: Json | null;
          fonte?: string | null;
          lead_id?: string;
          telefone?: string | null;
        };
        Relationships: [];
      };
      dry_run_site_check: {
        Row: {
          checked_at: string;
          cnpj: string | null;
          empresa: string | null;
          id: string;
          lead_id: string | null;
          maps_website: string | null;
          payload_site: string | null;
          site_final: string | null;
          would_delete: boolean | null;
        };
        Insert: {
          checked_at?: string;
          cnpj?: string | null;
          empresa?: string | null;
          id?: string;
          lead_id?: string | null;
          maps_website?: string | null;
          payload_site?: string | null;
          site_final?: string | null;
          would_delete?: boolean | null;
        };
        Update: {
          checked_at?: string;
          cnpj?: string | null;
          empresa?: string | null;
          id?: string;
          lead_id?: string | null;
          maps_website?: string | null;
          payload_site?: string | null;
          site_final?: string | null;
          would_delete?: boolean | null;
        };
        Relationships: [];
      };
      email_blacklist: {
        Row: {
          created_at: string;
          domain: string;
          id: string;
          org_id: string;
        };
        Insert: {
          created_at?: string;
          domain: string;
          id?: string;
          org_id: string;
        };
        Update: {
          created_at?: string;
          domain?: string;
          id?: string;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'email_blacklist_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      email_suppressions: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          lead_id: string | null;
          org_id: string;
          reason: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          lead_id?: string | null;
          org_id: string;
          reason?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          lead_id?: string | null;
          org_id?: string;
          reason?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'email_suppressions_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'email_suppressions_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads_no_active_enrollment';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'email_suppressions_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_leads_cadence_limbo';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'email_suppressions_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_meeting_webhook_candidates';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'email_suppressions_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_reminders_due';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'email_suppressions_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'vw_callface_reciclagem';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'email_suppressions_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      enrichment_attempts: {
        Row: {
          created_at: string;
          duration_ms: number | null;
          error_message: string | null;
          id: string;
          lead_id: string;
          provider: string;
          response_data: Json | null;
          status: Database['public']['Enums']['enrichment_status'];
        };
        Insert: {
          created_at?: string;
          duration_ms?: number | null;
          error_message?: string | null;
          id?: string;
          lead_id: string;
          provider: string;
          response_data?: Json | null;
          status: Database['public']['Enums']['enrichment_status'];
        };
        Update: {
          created_at?: string;
          duration_ms?: number | null;
          error_message?: string | null;
          id?: string;
          lead_id?: string;
          provider?: string;
          response_data?: Json | null;
          status?: Database['public']['Enums']['enrichment_status'];
        };
        Relationships: [
          {
            foreignKeyName: 'enrichment_attempts_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'enrichment_attempts_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads_no_active_enrollment';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'enrichment_attempts_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_leads_cadence_limbo';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'enrichment_attempts_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_meeting_webhook_candidates';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'enrichment_attempts_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_reminders_due';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'enrichment_attempts_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'vw_callface_reciclagem';
            referencedColumns: ['lead_id'];
          },
        ];
      };
      faxina_log: {
        Row: {
          cnpj: string | null;
          dados: Json | null;
          empresa: string | null;
          executado_em: string;
          id: number;
          lead_id: string | null;
          motivo: string | null;
          telefone: string | null;
        };
        Insert: {
          cnpj?: string | null;
          dados?: Json | null;
          empresa?: string | null;
          executado_em?: string;
          id?: number;
          lead_id?: string | null;
          motivo?: string | null;
          telefone?: string | null;
        };
        Update: {
          cnpj?: string | null;
          dados?: Json | null;
          empresa?: string | null;
          executado_em?: string;
          id?: number;
          lead_id?: string | null;
          motivo?: string | null;
          telefone?: string | null;
        };
        Relationships: [];
      };
      fit_score_rules: {
        Row: {
          created_at: string;
          field: string;
          id: string;
          operator: string;
          org_id: string;
          points: number;
          sort_order: number;
          value: string | null;
        };
        Insert: {
          created_at?: string;
          field: string;
          id?: string;
          operator: string;
          org_id: string;
          points: number;
          sort_order?: number;
          value?: string | null;
        };
        Update: {
          created_at?: string;
          field?: string;
          id?: string;
          operator?: string;
          org_id?: string;
          points?: number;
          sort_order?: number;
          value?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'fit_score_rules_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      gmail_connections: {
        Row: {
          access_token_encrypted: string;
          cached_signature: string | null;
          created_at: string;
          custom_signature: string | null;
          email_address: string;
          id: string;
          org_id: string;
          refresh_token_encrypted: string;
          signature_cached_at: string | null;
          status: Database['public']['Enums']['connection_status'];
          token_expires_at: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          access_token_encrypted: string;
          cached_signature?: string | null;
          created_at?: string;
          custom_signature?: string | null;
          email_address: string;
          id?: string;
          org_id: string;
          refresh_token_encrypted: string;
          signature_cached_at?: string | null;
          status?: Database['public']['Enums']['connection_status'];
          token_expires_at: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          access_token_encrypted?: string;
          cached_signature?: string | null;
          created_at?: string;
          custom_signature?: string | null;
          email_address?: string;
          id?: string;
          org_id?: string;
          refresh_token_encrypted?: string;
          signature_cached_at?: string | null;
          status?: Database['public']['Enums']['connection_status'];
          token_expires_at?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'gmail_connections_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      goals: {
        Row: {
          activities_target: number;
          conversion_target: number;
          created_at: string;
          created_by: string;
          id: string;
          leads_finished_target: number | null;
          leads_opened_target: number;
          meetings_held_target: number;
          meetings_scheduled_target: number;
          month: string;
          opportunity_target: number;
          org_id: string;
          sao_target: number;
          updated_at: string;
        };
        Insert: {
          activities_target?: number;
          conversion_target?: number;
          created_at?: string;
          created_by: string;
          id?: string;
          leads_finished_target?: number | null;
          leads_opened_target?: number;
          meetings_held_target?: number;
          meetings_scheduled_target?: number;
          month: string;
          opportunity_target?: number;
          org_id: string;
          sao_target?: number;
          updated_at?: string;
        };
        Update: {
          activities_target?: number;
          conversion_target?: number;
          created_at?: string;
          created_by?: string;
          id?: string;
          leads_finished_target?: number | null;
          leads_opened_target?: number;
          meetings_held_target?: number;
          meetings_scheduled_target?: number;
          month?: string;
          opportunity_target?: number;
          org_id?: string;
          sao_target?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'goals_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      goals_per_user: {
        Row: {
          activities_target: number;
          calls_connected_target: number;
          calls_target: number;
          conversion_target: number;
          created_at: string;
          id: string;
          leads_opened_target: number;
          meetings_held_target: number;
          meetings_scheduled_target: number;
          month: string;
          opportunity_target: number;
          org_id: string;
          sao_target: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          activities_target?: number;
          calls_connected_target?: number;
          calls_target?: number;
          conversion_target?: number;
          created_at?: string;
          id?: string;
          leads_opened_target?: number;
          meetings_held_target?: number;
          meetings_scheduled_target?: number;
          month: string;
          opportunity_target?: number;
          org_id: string;
          sao_target?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          activities_target?: number;
          calls_connected_target?: number;
          calls_target?: number;
          conversion_target?: number;
          created_at?: string;
          id?: string;
          leads_opened_target?: number;
          meetings_held_target?: number;
          meetings_scheduled_target?: number;
          month?: string;
          opportunity_target?: number;
          org_id?: string;
          sao_target?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'goals_per_user_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      interactions: {
        Row: {
          ai_generated: boolean;
          cadence_id: string | null;
          channel: Database['public']['Enums']['channel_type'];
          contact_id: string | null;
          created_at: string;
          external_id: string | null;
          id: string;
          lead_id: string;
          message_content: string | null;
          metadata: Json | null;
          org_id: string;
          original_template_id: string | null;
          performed_by: string | null;
          step_id: string | null;
          type: Database['public']['Enums']['interaction_type'];
        };
        Insert: {
          ai_generated?: boolean;
          cadence_id?: string | null;
          channel: Database['public']['Enums']['channel_type'];
          contact_id?: string | null;
          created_at?: string;
          external_id?: string | null;
          id?: string;
          lead_id: string;
          message_content?: string | null;
          metadata?: Json | null;
          org_id: string;
          original_template_id?: string | null;
          performed_by?: string | null;
          step_id?: string | null;
          type: Database['public']['Enums']['interaction_type'];
        };
        Update: {
          ai_generated?: boolean;
          cadence_id?: string | null;
          channel?: Database['public']['Enums']['channel_type'];
          contact_id?: string | null;
          created_at?: string;
          external_id?: string | null;
          id?: string;
          lead_id?: string;
          message_content?: string | null;
          metadata?: Json | null;
          org_id?: string;
          original_template_id?: string | null;
          performed_by?: string | null;
          step_id?: string | null;
          type?: Database['public']['Enums']['interaction_type'];
        };
        Relationships: [
          {
            foreignKeyName: 'interactions_cadence_id_fkey';
            columns: ['cadence_id'];
            isOneToOne: false;
            referencedRelation: 'cadences';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'interactions_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'lead_contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'interactions_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'interactions_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads_no_active_enrollment';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'interactions_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_leads_cadence_limbo';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'interactions_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_meeting_webhook_candidates';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'interactions_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_reminders_due';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'interactions_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'vw_callface_reciclagem';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'interactions_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'interactions_original_template_id_fkey';
            columns: ['original_template_id'];
            isOneToOne: false;
            referencedRelation: 'message_templates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'interactions_step_id_fkey';
            columns: ['step_id'];
            isOneToOne: false;
            referencedRelation: 'cadence_steps';
            referencedColumns: ['id'];
          },
        ];
      };
      lead_contacts: {
        Row: {
          created_at: string;
          emails: Json;
          first_name: string | null;
          id: string;
          is_primary: boolean;
          job_title: string | null;
          last_name: string | null;
          lead_id: string;
          org_id: string;
          phones: Json;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          emails?: Json;
          first_name?: string | null;
          id?: string;
          is_primary?: boolean;
          job_title?: string | null;
          last_name?: string | null;
          lead_id: string;
          org_id: string;
          phones?: Json;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          emails?: Json;
          first_name?: string | null;
          id?: string;
          is_primary?: boolean;
          job_title?: string | null;
          last_name?: string | null;
          lead_id?: string;
          org_id?: string;
          phones?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'lead_contacts_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lead_contacts_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads_no_active_enrollment';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lead_contacts_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_leads_cadence_limbo';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lead_contacts_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_meeting_webhook_candidates';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'lead_contacts_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_reminders_due';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'lead_contacts_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'vw_callface_reciclagem';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'lead_contacts_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      lead_import_errors: {
        Row: {
          cnpj: string | null;
          created_at: string;
          error_message: string;
          id: string;
          import_id: string;
          kind: string;
          row_number: number;
        };
        Insert: {
          cnpj?: string | null;
          created_at?: string;
          error_message: string;
          id?: string;
          import_id: string;
          kind?: string;
          row_number: number;
        };
        Update: {
          cnpj?: string | null;
          created_at?: string;
          error_message?: string;
          id?: string;
          import_id?: string;
          kind?: string;
          row_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'lead_import_errors_import_id_fkey';
            columns: ['import_id'];
            isOneToOne: false;
            referencedRelation: 'lead_imports';
            referencedColumns: ['id'];
          },
        ];
      };
      lead_imports: {
        Row: {
          created_at: string;
          created_by: string | null;
          duplicate_count: number;
          error_count: number;
          file_name: string;
          id: string;
          lead_source: string | null;
          org_id: string;
          processed_rows: number;
          status: Database['public']['Enums']['import_status'];
          success_count: number;
          total_rows: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          duplicate_count?: number;
          error_count?: number;
          file_name: string;
          id?: string;
          lead_source?: string | null;
          org_id: string;
          processed_rows?: number;
          status?: Database['public']['Enums']['import_status'];
          success_count?: number;
          total_rows?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          duplicate_count?: number;
          error_count?: number;
          file_name?: string;
          id?: string;
          lead_source?: string | null;
          org_id?: string;
          processed_rows?: number;
          status?: Database['public']['Enums']['import_status'];
          success_count?: number;
          total_rows?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'lead_imports_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      leads: {
        Row: {
          archived_at: string | null;
          assigned_to: string | null;
          callface_enviado_at: string | null;
          canal: string | null;
          closer_id: string | null;
          cnae: string | null;
          cnpj: string | null;
          contacted_at: string | null;
          created_at: string;
          created_by: string | null;
          custom_field_values: Json;
          deleted_at: string | null;
          email: string | null;
          email_bounced_at: string | null;
          emails: Json | null;
          endereco: Json | null;
          engagement_score: number | null;
          enriched_at: string | null;
          enrichment_status: Database['public']['Enums']['enrichment_status'];
          faturamento_estimado: number | null;
          first_name: string | null;
          fit_score: number | null;
          id: string;
          import_id: string | null;
          instagram: string | null;
          is_inbound: boolean;
          job_title: string | null;
          last_name: string | null;
          lead_source: string | null;
          linkedin: string | null;
          loss_notes: string | null;
          loss_reason_id: string | null;
          lost_at: string | null;
          meeting_held_at: string | null;
          meeting_scheduled_at: string | null;
          meeting_starts_at: string | null;
          nome_fantasia: string | null;
          notes: string | null;
          org_id: string;
          phones: Json | null;
          porte: string | null;
          qualified_at: string | null;
          razao_social: string | null;
          segmento: string | null;
          situacao_cadastral: string | null;
          socios: Json | null;
          source_id: string | null;
          status: Database['public']['Enums']['lead_status'];
          telefone: string | null;
          updated_at: string;
          website: string | null;
          whatsapp_abordado_at: string | null;
          whatsapp_invalid_at: string | null;
          won_at: string | null;
          won_by: string | null;
        };
        Insert: {
          archived_at?: string | null;
          assigned_to?: string | null;
          callface_enviado_at?: string | null;
          canal?: string | null;
          closer_id?: string | null;
          cnae?: string | null;
          cnpj?: string | null;
          contacted_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          custom_field_values?: Json;
          deleted_at?: string | null;
          email?: string | null;
          email_bounced_at?: string | null;
          emails?: Json | null;
          endereco?: Json | null;
          engagement_score?: number | null;
          enriched_at?: string | null;
          enrichment_status?: Database['public']['Enums']['enrichment_status'];
          faturamento_estimado?: number | null;
          first_name?: string | null;
          fit_score?: number | null;
          id?: string;
          import_id?: string | null;
          instagram?: string | null;
          is_inbound?: boolean;
          job_title?: string | null;
          last_name?: string | null;
          lead_source?: string | null;
          linkedin?: string | null;
          loss_notes?: string | null;
          loss_reason_id?: string | null;
          lost_at?: string | null;
          meeting_held_at?: string | null;
          meeting_scheduled_at?: string | null;
          meeting_starts_at?: string | null;
          nome_fantasia?: string | null;
          notes?: string | null;
          org_id: string;
          phones?: Json | null;
          porte?: string | null;
          qualified_at?: string | null;
          razao_social?: string | null;
          segmento?: string | null;
          situacao_cadastral?: string | null;
          socios?: Json | null;
          source_id?: string | null;
          status?: Database['public']['Enums']['lead_status'];
          telefone?: string | null;
          updated_at?: string;
          website?: string | null;
          whatsapp_abordado_at?: string | null;
          whatsapp_invalid_at?: string | null;
          won_at?: string | null;
          won_by?: string | null;
        };
        Update: {
          archived_at?: string | null;
          assigned_to?: string | null;
          callface_enviado_at?: string | null;
          canal?: string | null;
          closer_id?: string | null;
          cnae?: string | null;
          cnpj?: string | null;
          contacted_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          custom_field_values?: Json;
          deleted_at?: string | null;
          email?: string | null;
          email_bounced_at?: string | null;
          emails?: Json | null;
          endereco?: Json | null;
          engagement_score?: number | null;
          enriched_at?: string | null;
          enrichment_status?: Database['public']['Enums']['enrichment_status'];
          faturamento_estimado?: number | null;
          first_name?: string | null;
          fit_score?: number | null;
          id?: string;
          import_id?: string | null;
          instagram?: string | null;
          is_inbound?: boolean;
          job_title?: string | null;
          last_name?: string | null;
          lead_source?: string | null;
          linkedin?: string | null;
          loss_notes?: string | null;
          loss_reason_id?: string | null;
          lost_at?: string | null;
          meeting_held_at?: string | null;
          meeting_scheduled_at?: string | null;
          meeting_starts_at?: string | null;
          nome_fantasia?: string | null;
          notes?: string | null;
          org_id?: string;
          phones?: Json | null;
          porte?: string | null;
          qualified_at?: string | null;
          razao_social?: string | null;
          segmento?: string | null;
          situacao_cadastral?: string | null;
          socios?: Json | null;
          source_id?: string | null;
          status?: Database['public']['Enums']['lead_status'];
          telefone?: string | null;
          updated_at?: string;
          website?: string | null;
          whatsapp_abordado_at?: string | null;
          whatsapp_invalid_at?: string | null;
          won_at?: string | null;
          won_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'leads_closer_id_fkey';
            columns: ['closer_id'];
            isOneToOne: false;
            referencedRelation: 'closers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_import_id_fkey';
            columns: ['import_id'];
            isOneToOne: false;
            referencedRelation: 'lead_imports';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_loss_reason_id_fkey';
            columns: ['loss_reason_id'];
            isOneToOne: false;
            referencedRelation: 'loss_reasons';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      loss_reasons: {
        Row: {
          created_at: string;
          id: string;
          is_system: boolean;
          name: string;
          org_id: string;
          sort_order: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name: string;
          org_id: string;
          sort_order?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name?: string;
          org_id?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'loss_reasons_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      meeting_reminder_log: {
        Row: {
          channel: string;
          detail: string | null;
          id: string;
          lead_id: string;
          meeting_starts_at: string;
          org_id: string;
          reminder_step_id: string;
          sent_at: string;
          status: string;
        };
        Insert: {
          channel: string;
          detail?: string | null;
          id?: string;
          lead_id: string;
          meeting_starts_at: string;
          org_id: string;
          reminder_step_id: string;
          sent_at?: string;
          status?: string;
        };
        Update: {
          channel?: string;
          detail?: string | null;
          id?: string;
          lead_id?: string;
          meeting_starts_at?: string;
          org_id?: string;
          reminder_step_id?: string;
          sent_at?: string;
          status?: string;
        };
        Relationships: [];
      };
      meeting_webhook_dispatch_log: {
        Row: {
          created_at: string;
          detail: string | null;
          id: string;
          lead_id: string;
          meeting_starts_at: string;
          momento: string;
          org_id: string;
          payload: Json | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          detail?: string | null;
          id?: string;
          lead_id: string;
          meeting_starts_at: string;
          momento: string;
          org_id: string;
          payload?: Json | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          detail?: string | null;
          id?: string;
          lead_id?: string;
          meeting_starts_at?: string;
          momento?: string;
          org_id?: string;
          payload?: Json | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'meeting_webhook_dispatch_log_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'meeting_webhook_dispatch_log_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads_no_active_enrollment';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'meeting_webhook_dispatch_log_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_leads_cadence_limbo';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'meeting_webhook_dispatch_log_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_meeting_webhook_candidates';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'meeting_webhook_dispatch_log_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_reminders_due';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'meeting_webhook_dispatch_log_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'vw_callface_reciclagem';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'meeting_webhook_dispatch_log_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      mensagens_status: {
        Row: {
          categoria_cobranca: string | null;
          criado_em: string;
          display_phone_number: string | null;
          erro_codigo: number | null;
          erro_titulo: string | null;
          id: number;
          ocorrido_em: string | null;
          phone_number_id: string | null;
          status: string;
          telefone: string | null;
          wamid: string;
        };
        Insert: {
          categoria_cobranca?: string | null;
          criado_em?: string;
          display_phone_number?: string | null;
          erro_codigo?: number | null;
          erro_titulo?: string | null;
          id?: number;
          ocorrido_em?: string | null;
          phone_number_id?: string | null;
          status: string;
          telefone?: string | null;
          wamid: string;
        };
        Update: {
          categoria_cobranca?: string | null;
          criado_em?: string;
          display_phone_number?: string | null;
          erro_codigo?: number | null;
          erro_titulo?: string | null;
          id?: number;
          ocorrido_em?: string | null;
          phone_number_id?: string | null;
          status?: string;
          telefone?: string | null;
          wamid?: string;
        };
        Relationships: [];
      };
      message_templates: {
        Row: {
          body: string;
          channel: Database['public']['Enums']['channel_type'];
          created_at: string;
          created_by: string | null;
          id: string;
          is_system: boolean;
          name: string;
          org_id: string;
          subject: string | null;
          updated_at: string;
          variables_used: string[] | null;
        };
        Insert: {
          body: string;
          channel: Database['public']['Enums']['channel_type'];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_system?: boolean;
          name: string;
          org_id: string;
          subject?: string | null;
          updated_at?: string;
          variables_used?: string[] | null;
        };
        Update: {
          body?: string;
          channel?: Database['public']['Enums']['channel_type'];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_system?: boolean;
          name?: string;
          org_id?: string;
          subject?: string | null;
          updated_at?: string;
          variables_used?: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'message_templates_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      no_show_disparos: {
        Row: {
          criado_em: string;
          enviado_2_at: string | null;
          enviado_at: string | null;
          erro: string | null;
          id: number;
          lead_id: string;
          ligacao_enviada_at: string | null;
          ligacao_resultado: string | null;
          ligacao_tentativas: number;
          meeting_starts_at: string;
          nome: string | null;
          novo_event_id: string | null;
          remarcado_para: string | null;
          respondeu_at: string | null;
          resposta: string | null;
          status_entrega: string | null;
          telefone: string | null;
          wamid: string | null;
          wamid_2: string | null;
        };
        Insert: {
          criado_em?: string;
          enviado_2_at?: string | null;
          enviado_at?: string | null;
          erro?: string | null;
          id?: number;
          lead_id: string;
          ligacao_enviada_at?: string | null;
          ligacao_resultado?: string | null;
          ligacao_tentativas?: number;
          meeting_starts_at: string;
          nome?: string | null;
          novo_event_id?: string | null;
          remarcado_para?: string | null;
          respondeu_at?: string | null;
          resposta?: string | null;
          status_entrega?: string | null;
          telefone?: string | null;
          wamid?: string | null;
          wamid_2?: string | null;
        };
        Update: {
          criado_em?: string;
          enviado_2_at?: string | null;
          enviado_at?: string | null;
          erro?: string | null;
          id?: number;
          lead_id?: string;
          ligacao_enviada_at?: string | null;
          ligacao_resultado?: string | null;
          ligacao_tentativas?: number;
          meeting_starts_at?: string;
          nome?: string | null;
          novo_event_id?: string | null;
          remarcado_para?: string | null;
          respondeu_at?: string | null;
          resposta?: string | null;
          status_entrega?: string | null;
          telefone?: string | null;
          wamid?: string | null;
          wamid_2?: string | null;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          org_id: string;
          read_at: string | null;
          resource_id: string | null;
          resource_type: string | null;
          title: string;
          type: Database['public']['Enums']['notification_type'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          org_id: string;
          read_at?: string | null;
          resource_id?: string | null;
          resource_type?: string | null;
          title: string;
          type: Database['public']['Enums']['notification_type'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          org_id?: string;
          read_at?: string | null;
          resource_id?: string | null;
          resource_type?: string | null;
          title?: string;
          type?: Database['public']['Enums']['notification_type'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      numero_qualidade: {
        Row: {
          criado_em: string;
          de: string | null;
          detalhe: Json | null;
          evento: string;
          id: number;
          para: string | null;
          phone_number: string | null;
        };
        Insert: {
          criado_em?: string;
          de?: string | null;
          detalhe?: Json | null;
          evento: string;
          id?: number;
          para?: string | null;
          phone_number?: string | null;
        };
        Update: {
          criado_em?: string;
          de?: string | null;
          detalhe?: Json | null;
          evento?: string;
          id?: number;
          para?: string | null;
          phone_number?: string | null;
        };
        Relationships: [];
      };
      organization_call_settings: {
        Row: {
          calls_enabled: boolean;
          created_at: string;
          daily_call_target: number;
          default_call_type: Database['public']['Enums']['call_type'];
          dialer_daily_limit_per_lead: number;
          dialer_simultaneous_phones: number;
          id: string;
          org_id: string;
          significant_threshold_seconds: number;
          updated_at: string;
        };
        Insert: {
          calls_enabled?: boolean;
          created_at?: string;
          daily_call_target?: number;
          default_call_type?: Database['public']['Enums']['call_type'];
          dialer_daily_limit_per_lead?: number;
          dialer_simultaneous_phones?: number;
          id?: string;
          org_id: string;
          significant_threshold_seconds?: number;
          updated_at?: string;
        };
        Update: {
          calls_enabled?: boolean;
          created_at?: string;
          daily_call_target?: number;
          default_call_type?: Database['public']['Enums']['call_type'];
          dialer_daily_limit_per_lead?: number;
          dialer_simultaneous_phones?: number;
          id?: string;
          org_id?: string;
          significant_threshold_seconds?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_call_settings_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: true;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_members: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          id: string;
          invited_at: string;
          invited_expires_at: string | null;
          org_id: string;
          role: Database['public']['Enums']['member_role'];
          status: Database['public']['Enums']['member_status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          id?: string;
          invited_at?: string;
          invited_expires_at?: string | null;
          org_id: string;
          role?: Database['public']['Enums']['member_role'];
          status?: Database['public']['Enums']['member_status'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          id?: string;
          invited_at?: string;
          invited_expires_at?: string | null;
          org_id?: string;
          role?: Database['public']['Enums']['member_role'];
          status?: Database['public']['Enums']['member_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_members_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organizations: {
        Row: {
          abm_enabled: boolean;
          abm_group_field: string;
          created_at: string;
          id: string;
          lead_visibility_mode: string;
          logo_url: string | null;
          member_limit_override: number | null;
          name: string;
          onboarding_step: number | null;
          owner_id: string;
          slug: string;
          stripe_customer_id: string | null;
          updated_at: string;
        };
        Insert: {
          abm_enabled?: boolean;
          abm_group_field?: string;
          created_at?: string;
          id?: string;
          lead_visibility_mode?: string;
          logo_url?: string | null;
          member_limit_override?: number | null;
          name: string;
          onboarding_step?: number | null;
          owner_id: string;
          slug: string;
          stripe_customer_id?: string | null;
          updated_at?: string;
        };
        Update: {
          abm_enabled?: boolean;
          abm_group_field?: string;
          created_at?: string;
          id?: string;
          lead_visibility_mode?: string;
          logo_url?: string | null;
          member_limit_override?: number | null;
          name?: string;
          onboarding_step?: number | null;
          owner_id?: string;
          slug?: string;
          stripe_customer_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      phone_blacklist: {
        Row: {
          created_at: string;
          id: string;
          org_id: string;
          phone_pattern: string;
          reason: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          org_id: string;
          phone_pattern: string;
          reason?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string;
          phone_pattern?: string;
          reason?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'phone_blacklist_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      plans: {
        Row: {
          active: boolean;
          additional_user_price_cents: number;
          created_at: string;
          features: Json;
          id: string;
          included_users: number;
          max_ai_per_day: number;
          max_leads: number;
          max_whatsapp_per_month: number;
          name: string;
          price_cents: number;
          slug: string;
          stripe_price_id: string | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          additional_user_price_cents: number;
          created_at?: string;
          features?: Json;
          id?: string;
          included_users?: number;
          max_ai_per_day: number;
          max_leads: number;
          max_whatsapp_per_month: number;
          name: string;
          price_cents: number;
          slug: string;
          stripe_price_id?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          additional_user_price_cents?: number;
          created_at?: string;
          features?: Json;
          id?: string;
          included_users?: number;
          max_ai_per_day?: number;
          max_leads?: number;
          max_whatsapp_per_month?: number;
          name?: string;
          price_cents?: number;
          slug?: string;
          stripe_price_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      provider_events: {
        Row: {
          event_id: string;
          event_type: string | null;
          id: string;
          org_id: string | null;
          payload: Json | null;
          processed_at: string;
          provider: string;
        };
        Insert: {
          event_id: string;
          event_type?: string | null;
          id?: string;
          org_id?: string | null;
          payload?: Json | null;
          processed_at?: string;
          provider: string;
        };
        Update: {
          event_id?: string;
          event_type?: string | null;
          id?: string;
          org_id?: string | null;
          payload?: Json | null;
          processed_at?: string;
          provider?: string;
        };
        Relationships: [];
      };
      reminder_source_context: {
        Row: {
          context: string;
          lead_source: string;
          org_id: string;
        };
        Insert: {
          context: string;
          lead_source: string;
          org_id: string;
        };
        Update: {
          context?: string;
          lead_source?: string;
          org_id?: string;
        };
        Relationships: [];
      };
      reminder_steps: {
        Row: {
          active: boolean;
          anchor: string;
          channel: string;
          context: string;
          created_at: string;
          id: string;
          message_template_id: string | null;
          offset_minutes: number;
          org_id: string;
          step_order: number;
        };
        Insert: {
          active?: boolean;
          anchor?: string;
          channel: string;
          context: string;
          created_at?: string;
          id?: string;
          message_template_id?: string | null;
          offset_minutes?: number;
          org_id: string;
          step_order: number;
        };
        Update: {
          active?: boolean;
          anchor?: string;
          channel?: string;
          context?: string;
          created_at?: string;
          id?: string;
          message_template_id?: string | null;
          offset_minutes?: number;
          org_id?: string;
          step_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'reminder_steps_message_template_id_fkey';
            columns: ['message_template_id'];
            isOneToOne: false;
            referencedRelation: 'message_templates';
            referencedColumns: ['id'];
          },
        ];
      };
      scheduled_activities: {
        Row: {
          call_provider: string | null;
          channel: Database['public']['Enums']['channel_type'];
          completed_at: string | null;
          created_at: string;
          id: string;
          lead_id: string;
          notes: string | null;
          org_id: string;
          overdue_reminder_sent_at: string | null;
          reminder_sent_at: string | null;
          scheduled_at: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          call_provider?: string | null;
          channel: Database['public']['Enums']['channel_type'];
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          lead_id: string;
          notes?: string | null;
          org_id: string;
          overdue_reminder_sent_at?: string | null;
          reminder_sent_at?: string | null;
          scheduled_at: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          call_provider?: string | null;
          channel?: Database['public']['Enums']['channel_type'];
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          lead_id?: string;
          notes?: string | null;
          org_id?: string;
          overdue_reminder_sent_at?: string | null;
          reminder_sent_at?: string | null;
          scheduled_at?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'scheduled_activities_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'scheduled_activities_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads_no_active_enrollment';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'scheduled_activities_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_leads_cadence_limbo';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'scheduled_activities_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_meeting_webhook_candidates';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'scheduled_activities_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'v_reminders_due';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'scheduled_activities_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'vw_callface_reciclagem';
            referencedColumns: ['lead_id'];
          },
          {
            foreignKeyName: 'scheduled_activities_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      segmento_aliases: {
        Row: {
          alias: string;
          created_at: string | null;
          org_id: string;
          segmento: string;
        };
        Insert: {
          alias: string;
          created_at?: string | null;
          org_id: string;
          segmento: string;
        };
        Update: {
          alias?: string;
          created_at?: string | null;
          org_id?: string;
          segmento?: string;
        };
        Relationships: [];
      };
      segmento_normalization_log: {
        Row: {
          created_at: string | null;
          fonte: string | null;
          id: number;
          lead_id: string | null;
          org_id: string | null;
          valor_final: string | null;
          valor_original: string | null;
        };
        Insert: {
          created_at?: string | null;
          fonte?: string | null;
          id?: number;
          lead_id?: string | null;
          org_id?: string | null;
          valor_final?: string | null;
          valor_original?: string | null;
        };
        Update: {
          created_at?: string | null;
          fonte?: string | null;
          id?: number;
          lead_id?: string | null;
          org_id?: string | null;
          valor_final?: string | null;
          valor_original?: string | null;
        };
        Relationships: [];
      };
      standard_field_settings: {
        Row: {
          created_at: string;
          field_key: string;
          id: string;
          is_required_lost: boolean;
          is_required_meeting: boolean;
          is_required_won: boolean;
          is_visible: boolean;
          options: Json | null;
          org_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          field_key: string;
          id?: string;
          is_required_lost?: boolean;
          is_required_meeting?: boolean;
          is_required_won?: boolean;
          is_visible?: boolean;
          options?: Json | null;
          org_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          field_key?: string;
          id?: string;
          is_required_lost?: boolean;
          is_required_meeting?: boolean;
          is_required_won?: boolean;
          is_visible?: boolean;
          options?: Json | null;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'standard_field_settings_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      stripe_events: {
        Row: {
          id: string;
          payload: Json | null;
          processed_at: string;
          type: string | null;
        };
        Insert: {
          id: string;
          payload?: Json | null;
          processed_at?: string;
          type?: string | null;
        };
        Update: {
          id?: string;
          payload?: Json | null;
          processed_at?: string;
          type?: string | null;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          created_at: string;
          current_period_end: string;
          current_period_start: string;
          id: string;
          org_id: string;
          plan_id: string;
          status: Database['public']['Enums']['subscription_status'];
          stripe_subscription_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          current_period_end?: string;
          current_period_start?: string;
          id?: string;
          org_id: string;
          plan_id: string;
          status?: Database['public']['Enums']['subscription_status'];
          stripe_subscription_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          current_period_end?: string;
          current_period_start?: string;
          id?: string;
          org_id?: string;
          plan_id?: string;
          status?: Database['public']['Enums']['subscription_status'];
          stripe_subscription_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: true;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_plan_id_fkey';
            columns: ['plan_id'];
            isOneToOne: false;
            referencedRelation: 'plans';
            referencedColumns: ['id'];
          },
        ];
      };
      webhook_endpoints: {
        Row: {
          created_at: string;
          created_by: string | null;
          events: string[];
          id: string;
          is_active: boolean;
          org_id: string;
          secret: string | null;
          updated_at: string;
          url: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          events?: string[];
          id?: string;
          is_active?: boolean;
          org_id: string;
          secret?: string | null;
          updated_at?: string;
          url: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          events?: string[];
          id?: string;
          is_active?: boolean;
          org_id?: string;
          secret?: string | null;
          updated_at?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'webhook_endpoints_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      webhook_events: {
        Row: {
          event_id: string;
          event_type: string;
          id: string;
          last_error: string | null;
          org_id: string | null;
          payload: Json | null;
          processed_at: string | null;
          provider: string;
          retry_count: number;
          status: string;
        };
        Insert: {
          event_id: string;
          event_type: string;
          id?: string;
          last_error?: string | null;
          org_id?: string | null;
          payload?: Json | null;
          processed_at?: string | null;
          provider: string;
          retry_count?: number;
          status?: string;
        };
        Update: {
          event_id?: string;
          event_type?: string;
          id?: string;
          last_error?: string | null;
          org_id?: string | null;
          payload?: Json | null;
          processed_at?: string | null;
          provider?: string;
          retry_count?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'webhook_events_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      whatsapp_call_sessions: {
        Row: {
          created_at: string;
          id: string;
          org_id: string;
          paired_at: string | null;
          phone_number: string | null;
          service_session_id: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          org_id: string;
          paired_at?: string | null;
          phone_number?: string | null;
          service_session_id: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string;
          paired_at?: string | null;
          phone_number?: string | null;
          service_session_id?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'whatsapp_call_sessions_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      whatsapp_connections: {
        Row: {
          access_token_encrypted: string;
          business_account_id: string;
          created_at: string;
          id: string;
          org_id: string;
          phone_number_id: string;
          status: Database['public']['Enums']['connection_status'];
          updated_at: string;
        };
        Insert: {
          access_token_encrypted: string;
          business_account_id: string;
          created_at?: string;
          id?: string;
          org_id: string;
          phone_number_id: string;
          status?: Database['public']['Enums']['connection_status'];
          updated_at?: string;
        };
        Update: {
          access_token_encrypted?: string;
          business_account_id?: string;
          created_at?: string;
          id?: string;
          org_id?: string;
          phone_number_id?: string;
          status?: Database['public']['Enums']['connection_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'whatsapp_connections_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: true;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      whatsapp_credits: {
        Row: {
          id: string;
          org_id: string;
          overage_count: number;
          period: string;
          plan_credits: number;
          used_credits: number;
        };
        Insert: {
          id?: string;
          org_id: string;
          overage_count?: number;
          period: string;
          plan_credits?: number;
          used_credits?: number;
        };
        Update: {
          id?: string;
          org_id?: string;
          overage_count?: number;
          period?: string;
          plan_credits?: number;
          used_credits?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'whatsapp_credits_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      whatsapp_instances: {
        Row: {
          created_at: string;
          id: string;
          instance_name: string;
          last_error: string | null;
          last_seen_at: string | null;
          last_status_payload: Json | null;
          next_reconnect_at: string | null;
          org_id: string;
          phone: string | null;
          qr_base64: string | null;
          reconnect_attempts: number;
          status: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          instance_name: string;
          last_error?: string | null;
          last_seen_at?: string | null;
          last_status_payload?: Json | null;
          next_reconnect_at?: string | null;
          org_id: string;
          phone?: string | null;
          qr_base64?: string | null;
          reconnect_attempts?: number;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          instance_name?: string;
          last_error?: string | null;
          last_seen_at?: string | null;
          last_status_payload?: Json | null;
          next_reconnect_at?: string | null;
          org_id?: string;
          phone?: string | null;
          qr_base64?: string | null;
          reconnect_attempts?: number;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'whatsapp_instances_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      whatsapp_pending_recordings: {
        Row: {
          created_at: string;
          recording_url: string;
          service_call_id: string;
        };
        Insert: {
          created_at?: string;
          recording_url: string;
          service_call_id: string;
        };
        Update: {
          created_at?: string;
          recording_url?: string;
          service_call_id?: string;
        };
        Relationships: [];
      };
      worker_run_state: {
        Row: {
          job_name: string;
          last_run_at: string | null;
          last_status: string | null;
          last_success_at: string | null;
          metadata: Json;
          updated_at: string;
        };
        Insert: {
          job_name: string;
          last_run_at?: string | null;
          last_status?: string | null;
          last_success_at?: string | null;
          metadata?: Json;
          updated_at?: string;
        };
        Update: {
          job_name?: string;
          last_run_at?: string | null;
          last_status?: string | null;
          last_success_at?: string | null;
          metadata?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      leads_no_active_enrollment: {
        Row: {
          archived_at: string | null;
          assigned_to: string | null;
          canal: string | null;
          closer_id: string | null;
          cnae: string | null;
          cnpj: string | null;
          contacted_at: string | null;
          created_at: string | null;
          created_by: string | null;
          custom_field_values: Json | null;
          deleted_at: string | null;
          email: string | null;
          email_bounced_at: string | null;
          emails: Json | null;
          endereco: Json | null;
          engagement_score: number | null;
          enriched_at: string | null;
          enrichment_status: Database['public']['Enums']['enrichment_status'] | null;
          faturamento_estimado: number | null;
          first_name: string | null;
          fit_score: number | null;
          id: string | null;
          import_id: string | null;
          instagram: string | null;
          is_inbound: boolean | null;
          job_title: string | null;
          last_name: string | null;
          lead_source: string | null;
          linkedin: string | null;
          lost_at: string | null;
          meeting_scheduled_at: string | null;
          nome_fantasia: string | null;
          notes: string | null;
          org_id: string | null;
          phones: Json | null;
          porte: string | null;
          qualified_at: string | null;
          razao_social: string | null;
          segmento: string | null;
          situacao_cadastral: string | null;
          socios: Json | null;
          source_id: string | null;
          status: Database['public']['Enums']['lead_status'] | null;
          telefone: string | null;
          updated_at: string | null;
          website: string | null;
          won_at: string | null;
          won_by: string | null;
        };
        Insert: {
          archived_at?: string | null;
          assigned_to?: string | null;
          canal?: string | null;
          closer_id?: string | null;
          cnae?: string | null;
          cnpj?: string | null;
          contacted_at?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          custom_field_values?: Json | null;
          deleted_at?: string | null;
          email?: string | null;
          email_bounced_at?: string | null;
          emails?: Json | null;
          endereco?: Json | null;
          engagement_score?: number | null;
          enriched_at?: string | null;
          enrichment_status?: Database['public']['Enums']['enrichment_status'] | null;
          faturamento_estimado?: number | null;
          first_name?: string | null;
          fit_score?: number | null;
          id?: string | null;
          import_id?: string | null;
          instagram?: string | null;
          is_inbound?: boolean | null;
          job_title?: string | null;
          last_name?: string | null;
          lead_source?: string | null;
          linkedin?: string | null;
          lost_at?: string | null;
          meeting_scheduled_at?: string | null;
          nome_fantasia?: string | null;
          notes?: string | null;
          org_id?: string | null;
          phones?: Json | null;
          porte?: string | null;
          qualified_at?: string | null;
          razao_social?: string | null;
          segmento?: string | null;
          situacao_cadastral?: string | null;
          socios?: Json | null;
          source_id?: string | null;
          status?: Database['public']['Enums']['lead_status'] | null;
          telefone?: string | null;
          updated_at?: string | null;
          website?: string | null;
          won_at?: string | null;
          won_by?: string | null;
        };
        Update: {
          archived_at?: string | null;
          assigned_to?: string | null;
          canal?: string | null;
          closer_id?: string | null;
          cnae?: string | null;
          cnpj?: string | null;
          contacted_at?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          custom_field_values?: Json | null;
          deleted_at?: string | null;
          email?: string | null;
          email_bounced_at?: string | null;
          emails?: Json | null;
          endereco?: Json | null;
          engagement_score?: number | null;
          enriched_at?: string | null;
          enrichment_status?: Database['public']['Enums']['enrichment_status'] | null;
          faturamento_estimado?: number | null;
          first_name?: string | null;
          fit_score?: number | null;
          id?: string | null;
          import_id?: string | null;
          instagram?: string | null;
          is_inbound?: boolean | null;
          job_title?: string | null;
          last_name?: string | null;
          lead_source?: string | null;
          linkedin?: string | null;
          lost_at?: string | null;
          meeting_scheduled_at?: string | null;
          nome_fantasia?: string | null;
          notes?: string | null;
          org_id?: string | null;
          phones?: Json | null;
          porte?: string | null;
          qualified_at?: string | null;
          razao_social?: string | null;
          segmento?: string | null;
          situacao_cadastral?: string | null;
          socios?: Json | null;
          source_id?: string | null;
          status?: Database['public']['Enums']['lead_status'] | null;
          telefone?: string | null;
          updated_at?: string | null;
          website?: string | null;
          won_at?: string | null;
          won_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'leads_closer_id_fkey';
            columns: ['closer_id'];
            isOneToOne: false;
            referencedRelation: 'closers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_import_id_fkey';
            columns: ['import_id'];
            isOneToOne: false;
            referencedRelation: 'lead_imports';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      org_members: {
        Row: {
          accepted_at: string | null;
          created_at: string | null;
          id: string | null;
          invited_at: string | null;
          org_id: string | null;
          role: Database['public']['Enums']['member_role'] | null;
          status: Database['public']['Enums']['member_status'] | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string | null;
          id?: string | null;
          invited_at?: string | null;
          org_id?: string | null;
          role?: Database['public']['Enums']['member_role'] | null;
          status?: Database['public']['Enums']['member_status'] | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string | null;
          id?: string | null;
          invited_at?: string | null;
          org_id?: string | null;
          role?: Database['public']['Enums']['member_role'] | null;
          status?: Database['public']['Enums']['member_status'] | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_members_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      v_leads_cadence_limbo: {
        Row: {
          archived_at: string | null;
          assigned_to: string | null;
          callface_enviado_at: string | null;
          canal: string | null;
          closer_id: string | null;
          cnae: string | null;
          cnpj: string | null;
          contacted_at: string | null;
          created_at: string | null;
          created_by: string | null;
          custom_field_values: Json | null;
          deleted_at: string | null;
          email: string | null;
          email_bounced_at: string | null;
          emails: Json | null;
          endereco: Json | null;
          engagement_score: number | null;
          enriched_at: string | null;
          enrichment_status: Database['public']['Enums']['enrichment_status'] | null;
          faturamento_estimado: number | null;
          first_name: string | null;
          fit_score: number | null;
          id: string | null;
          import_id: string | null;
          instagram: string | null;
          is_inbound: boolean | null;
          job_title: string | null;
          last_name: string | null;
          lead_source: string | null;
          linkedin: string | null;
          loss_notes: string | null;
          loss_reason_id: string | null;
          lost_at: string | null;
          meeting_held_at: string | null;
          meeting_scheduled_at: string | null;
          meeting_starts_at: string | null;
          nome_fantasia: string | null;
          notes: string | null;
          org_id: string | null;
          phones: Json | null;
          porte: string | null;
          qualified_at: string | null;
          razao_social: string | null;
          segmento: string | null;
          situacao_cadastral: string | null;
          socios: Json | null;
          source_id: string | null;
          status: Database['public']['Enums']['lead_status'] | null;
          telefone: string | null;
          updated_at: string | null;
          website: string | null;
          whatsapp_abordado_at: string | null;
          whatsapp_invalid_at: string | null;
          won_at: string | null;
          won_by: string | null;
        };
        Insert: {
          archived_at?: string | null;
          assigned_to?: string | null;
          callface_enviado_at?: string | null;
          canal?: string | null;
          closer_id?: string | null;
          cnae?: string | null;
          cnpj?: string | null;
          contacted_at?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          custom_field_values?: Json | null;
          deleted_at?: string | null;
          email?: string | null;
          email_bounced_at?: string | null;
          emails?: Json | null;
          endereco?: Json | null;
          engagement_score?: number | null;
          enriched_at?: string | null;
          enrichment_status?: Database['public']['Enums']['enrichment_status'] | null;
          faturamento_estimado?: number | null;
          first_name?: string | null;
          fit_score?: number | null;
          id?: string | null;
          import_id?: string | null;
          instagram?: string | null;
          is_inbound?: boolean | null;
          job_title?: string | null;
          last_name?: string | null;
          lead_source?: string | null;
          linkedin?: string | null;
          loss_notes?: string | null;
          loss_reason_id?: string | null;
          lost_at?: string | null;
          meeting_held_at?: string | null;
          meeting_scheduled_at?: string | null;
          meeting_starts_at?: string | null;
          nome_fantasia?: string | null;
          notes?: string | null;
          org_id?: string | null;
          phones?: Json | null;
          porte?: string | null;
          qualified_at?: string | null;
          razao_social?: string | null;
          segmento?: string | null;
          situacao_cadastral?: string | null;
          socios?: Json | null;
          source_id?: string | null;
          status?: Database['public']['Enums']['lead_status'] | null;
          telefone?: string | null;
          updated_at?: string | null;
          website?: string | null;
          whatsapp_abordado_at?: string | null;
          whatsapp_invalid_at?: string | null;
          won_at?: string | null;
          won_by?: string | null;
        };
        Update: {
          archived_at?: string | null;
          assigned_to?: string | null;
          callface_enviado_at?: string | null;
          canal?: string | null;
          closer_id?: string | null;
          cnae?: string | null;
          cnpj?: string | null;
          contacted_at?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          custom_field_values?: Json | null;
          deleted_at?: string | null;
          email?: string | null;
          email_bounced_at?: string | null;
          emails?: Json | null;
          endereco?: Json | null;
          engagement_score?: number | null;
          enriched_at?: string | null;
          enrichment_status?: Database['public']['Enums']['enrichment_status'] | null;
          faturamento_estimado?: number | null;
          first_name?: string | null;
          fit_score?: number | null;
          id?: string | null;
          import_id?: string | null;
          instagram?: string | null;
          is_inbound?: boolean | null;
          job_title?: string | null;
          last_name?: string | null;
          lead_source?: string | null;
          linkedin?: string | null;
          loss_notes?: string | null;
          loss_reason_id?: string | null;
          lost_at?: string | null;
          meeting_held_at?: string | null;
          meeting_scheduled_at?: string | null;
          meeting_starts_at?: string | null;
          nome_fantasia?: string | null;
          notes?: string | null;
          org_id?: string | null;
          phones?: Json | null;
          porte?: string | null;
          qualified_at?: string | null;
          razao_social?: string | null;
          segmento?: string | null;
          situacao_cadastral?: string | null;
          socios?: Json | null;
          source_id?: string | null;
          status?: Database['public']['Enums']['lead_status'] | null;
          telefone?: string | null;
          updated_at?: string | null;
          website?: string | null;
          whatsapp_abordado_at?: string | null;
          whatsapp_invalid_at?: string | null;
          won_at?: string | null;
          won_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'leads_closer_id_fkey';
            columns: ['closer_id'];
            isOneToOne: false;
            referencedRelation: 'closers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_import_id_fkey';
            columns: ['import_id'];
            isOneToOne: false;
            referencedRelation: 'lead_imports';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_loss_reason_id_fkey';
            columns: ['loss_reason_id'];
            isOneToOne: false;
            referencedRelation: 'loss_reasons';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      v_meeting_webhook_candidates: {
        Row: {
          calendar_event_id: string | null;
          first_name: string | null;
          last_name: string | null;
          lead_id: string | null;
          meet_link: string | null;
          meeting_scheduled_at: string | null;
          meeting_starts_at: string | null;
          nome_fantasia: string | null;
          org_id: string | null;
          razao_social: string | null;
          responsavel: string | null;
          responsavel_email: string | null;
          sdr_user_id: string | null;
          whatsapp_phone: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'leads_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      v_reminders_due: {
        Row: {
          calendar_event_id: string | null;
          channel: string | null;
          context: string | null;
          email: string | null;
          fire_at: string | null;
          first_name: string | null;
          last_name: string | null;
          lead_id: string | null;
          meet_link: string | null;
          meeting_scheduled_at: string | null;
          meeting_starts_at: string | null;
          message_template_id: string | null;
          nome_fantasia: string | null;
          org_id: string | null;
          razao_social: string | null;
          reminder_step_id: string | null;
          sdr_user_id: string | null;
          step_order: number | null;
          whatsapp_phone: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'leads_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reminder_steps_message_template_id_fkey';
            columns: ['message_template_id'];
            isOneToOne: false;
            referencedRelation: 'message_templates';
            referencedColumns: ['id'];
          },
        ];
      };
      vw_callface_reciclagem: {
        Row: {
          lead_id: string | null;
          lost_at: string | null;
          motivo: string | null;
          nome: string | null;
          org_id: string | null;
          telefone: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'leads_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      vw_confirmacao_ligacao_hoje: {
        Row: {
          event_id: string | null;
          id: number | null;
          lead_id: string | null;
          ligacao_tentativas: number | null;
          link_reuniao: string | null;
          nome: string | null;
          responsavel: string | null;
          reuniao_em: string | null;
          sdr: string | null;
          status_d1: string | null;
          telefone: string | null;
          telefone_sem_ddi: string | null;
        };
        Insert: {
          event_id?: string | null;
          id?: number | null;
          lead_id?: string | null;
          ligacao_tentativas?: number | null;
          link_reuniao?: string | null;
          nome?: string | null;
          responsavel?: string | null;
          reuniao_em?: string | null;
          sdr?: string | null;
          status_d1?: string | null;
          telefone?: string | null;
          telefone_sem_ddi?: never;
        };
        Update: {
          event_id?: string | null;
          id?: number | null;
          lead_id?: string | null;
          ligacao_tentativas?: number | null;
          link_reuniao?: string | null;
          nome?: string | null;
          responsavel?: string | null;
          reuniao_em?: string | null;
          sdr?: string | null;
          status_d1?: string | null;
          telefone?: string | null;
          telefone_sem_ddi?: never;
        };
        Relationships: [];
      };
      vw_entrega_por_numero: {
        Row: {
          dia: string | null;
          entregues: number | null;
          enviadas: number | null;
          falhas: number | null;
          lidas: number | null;
          numero: string | null;
          optout_131050: number | null;
          suprimidas_131049: number | null;
        };
        Relationships: [];
      };
      vw_mb_indicacoes: {
        Row: {
          ano: number | null;
          indicacoes: number | null;
          investidor: string | null;
          mes: number | null;
          mes_ref: string | null;
          reunioes_marcadas: number | null;
          reunioes_realizadas: number | null;
        };
        Relationships: [];
      };
      vw_no_show_fora_do_retrovisor: {
        Row: {
          first_name: string | null;
          horas_desde: number | null;
          lead_id: string | null;
          meeting_starts_at: string | null;
          nome_fantasia: string | null;
          quando: string | null;
          situacao: string | null;
          status: string | null;
          telefone: string | null;
          teve_toque_1: boolean | null;
          teve_toque_2: boolean | null;
        };
        Relationships: [];
      };
      vw_no_show_para_ligar: {
        Row: {
          calendar_id: string | null;
          horas_desde: number | null;
          lead_id: string | null;
          ligacao_tentativas: number | null;
          linha_id: number | null;
          link_reuniao: string | null;
          meeting_starts_at: string | null;
          nome: string | null;
          nome_fantasia: string | null;
          quando: string | null;
          responsavel: string | null;
          telefone_digitos: string | null;
          whatsapp_enviado_at: string | null;
        };
        Relationships: [];
      };
      vw_no_show_para_remarcar: {
        Row: {
          first_name: string | null;
          horas_desde: number | null;
          lead_id: string | null;
          meeting_starts_at: string | null;
          nome_fantasia: string | null;
          quando: string | null;
          telefone_e164: string | null;
          toque: number | null;
        };
        Relationships: [];
      };
      vw_sla_qualificacao_sdr: {
        Row: {
          bateu: number | null;
          div_cadastro: number | null;
          div_decisor: number | null;
          div_dor: number | null;
          div_timing: number | null;
          div_verba: number | null;
          divergiu: number | null;
          mes: string | null;
          nao_validado: number | null;
          pct_aderencia: number | null;
          reunioes_realizadas: number | null;
          sdr_id: string | null;
          sdr_nome: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      advance_enrollment_after_step: {
        Args: {
          p_enrollment_id: string;
          p_executed_step_id: string;
          p_performed_by: string;
        };
        Returns: {
          advanced: boolean;
          completed: boolean;
          new_step: number;
        }[];
      };
      aplicar_reagendamento: {
        Args: { p_event_id: string; p_novo_inicio: string };
        Returns: Json;
      };
      calculate_engagement_score: {
        Args: { p_lead_id: string };
        Returns: number;
      };
      calculate_tier_from_faixa: {
        Args: { faixa_input: string };
        Returns: string;
      };
      calculate_tier_from_faturamento: {
        Args: { faturamento_reais: number };
        Returns: string;
      };
      cleanup_provider_events: { Args: never; Returns: undefined };
      copiloto_leads_qualificacao: {
        Args: { p_lead_ids: string[] };
        Returns: {
          fit_score: number;
          lead_id: string;
          porte: string;
          qualificacao: Json;
          segmento: string;
        }[];
      };
      copiloto_match_lead: {
        Args: { p_emails: string[] };
        Returns: {
          canal: string;
          cnpj: string;
          email: string;
          empresa: string;
          faturamento_estimado: number;
          first_name: string;
          fit_score: number;
          is_inbound: boolean;
          job_title: string;
          last_name: string;
          lead_id: string;
          lead_source: string;
          notes: string;
          porte: string;
          qualificacao: Json;
          segmento: string;
          telefone: string;
        }[];
      };
      count_activities_by_performer: {
        Args: {
          p_cadence_ids?: string[];
          p_end: string;
          p_org_id: string;
          p_start: string;
        };
        Returns: {
          cnt: number;
          performer_id: string;
        }[];
      };
      count_leads_by_loss_reason: {
        Args: { p_org_id: string };
        Returns: {
          cnt: number;
          loss_reason_id: string;
        }[];
      };
      count_leads_by_status: {
        Args: { p_org_id: string };
        Returns: {
          cnt: number;
          status: string;
        }[];
      };
      count_leads_opened_by_sdr: {
        Args: {
          p_cadence_ids?: string[];
          p_end: string;
          p_org_id: string;
          p_start: string;
        };
        Returns: {
          cnt: number;
          performer_id: string;
        }[];
      };
      count_leads_opened_by_sdr_daily: {
        Args: {
          p_cadence_ids?: string[];
          p_end: string;
          p_org_id: string;
          p_start: string;
        };
        Returns: {
          opened_at: string;
          performer_id: string;
        }[];
      };
      dados_para_novo_evento: { Args: { p_lead_id: string }; Returns: Json };
      derive_segmento: {
        Args: { cnae: string; fantasia: string; razao: string };
        Returns: string;
      };
      derive_segmento_from_cnae: {
        Args: { cnae_input: string };
        Returns: string;
      };
      derive_segmento_from_nome: {
        Args: { fantasia: string; razao: string };
        Returns: string;
      };
      effective_due_brt: { Args: { ts: string }; Returns: string };
      enriquecer_lead: {
        Args: { p_data: Json; p_lead_id: string };
        Returns: undefined;
      };
      extract_website_from_email: {
        Args: { email_input: string };
        Returns: string;
      };
      faxina_leads_sem_site: { Args: { p_limite?: number }; Returns: number };
      fetch_conversion_ranking_data: {
        Args: { p_end: string; p_org_id: string; p_start: string };
        Returns: {
          assigned_to: string;
          lead_id: string;
          status: string;
          won_by: string;
          won_in_period: boolean;
        }[];
      };
      fetch_inactive_enrollment_candidates: {
        Args: { p_include_completed?: boolean };
        Returns: {
          auto_loss_after_days: number;
          auto_loss_reason_id: string;
          cadence_id: string;
          enrollment_id: string;
          enrollment_status: string;
          inactive_days: number;
          lead_id: string;
          org_id: string;
        }[];
      };
      fetch_overdue_manual_activities: {
        Args: never;
        Returns: {
          assigned_to: string;
          channel: string;
          lead_id: string;
          org_id: string;
        }[];
      };
      find_lead_id_by_phone: {
        Args: {
          p_org_id: string;
          p_phone_digits: string;
          p_sdr_user_id?: string;
        };
        Returns: string;
      };
      find_meetings_pending_outcome: {
        Args: never;
        Returns: {
          assigned_to: string;
          checkpoint_at: string;
          closer_id: string;
          escalated: boolean;
          has_open_feedback: boolean;
          has_pending_activity: boolean;
          lead_id: string;
          meeting_end: string;
          org_id: string;
          won_by: string;
        }[];
      };
      find_pending_invite_by_email: {
        Args: { p_email: string };
        Returns: {
          member_id: string;
          user_id: string;
        }[];
      };
      find_user_id_by_email: { Args: { p_email: string }; Returns: string };
      gerar_nome_curto: {
        Args: { p_nome_fantasia: string; p_razao_social: string };
        Returns: string;
      };
      gerar_nome_curto_socio: {
        Args: { p_nome_completo: string };
        Returns: string;
      };
      get_calls_for_v4sales:
        | { Args: { p_from_date?: string; p_limit?: number }; Returns: Json }
        | { Args: { p_month?: number; p_year?: number }; Returns: Json };
      get_calls_for_v4sales_by_ids: { Args: { p_ids: string[] }; Returns: Json };
      get_conversion_universe: {
        Args: {
          p_cadence_id?: string;
          p_end: string;
          p_start: string;
          p_user_ids?: string[];
        };
        Returns: {
          created_by: string;
          enrollments: Json;
          has_meeting_scheduled: boolean;
          has_replied: boolean;
          has_sent: boolean;
          lead_id: string;
          status: Database['public']['Enums']['lead_status'];
          won_at: string;
        }[];
      };
      get_distinct_lead_canais: {
        Args: never;
        Returns: {
          canal: string;
        }[];
      };
      get_distinct_lead_cnaes: {
        Args: never;
        Returns: {
          cnae: string;
        }[];
      };
      get_executed_steps: {
        Args: {
          p_cadence_ids: string[];
          p_lead_ids: string[];
          p_step_ids: string[];
        };
        Returns: {
          cadence_id: string;
          lead_id: string;
          step_id: string;
        }[];
      };
      get_indicacoes_leads_lookup: {
        Args: { p_api_token?: string };
        Returns: Json;
      };
      get_indicacoes_ranking: {
        Args: { p_api_token?: string; p_month: number; p_year: number };
        Returns: Json;
      };
      get_indicacoes_reunioes_realizadas: {
        Args: { p_api_token?: string; p_month: number; p_year: number };
        Returns: Json;
      };
      get_interaction_counts: {
        Args: {
          p_cadence_id?: string;
          p_end: string;
          p_exclude_channels: Database['public']['Enums']['channel_type'][];
          p_start: string;
          p_user_ids?: string[];
        };
        Returns: {
          channel: Database['public']['Enums']['channel_type'];
          day_brt: string;
          distinct_leads: number;
          first_at: string;
          last_at: string;
          n: number;
          performed_by: string;
          row_kind: string;
          type: Database['public']['Enums']['interaction_type'];
        }[];
      };
      get_leads_for_v4sales: {
        Args: { p_api_token: string; p_from_date?: string };
        Returns: Json[];
      };
      get_sdr_atividades_atrasadas_v3: {
        Args: { p_org_id: string };
        Returns: {
          atrasadas: number;
          email: string;
        }[];
      };
      get_sdr_leads_abertos: {
        Args: { p_month: number; p_year: number };
        Returns: Json;
      };
      get_sdr_leads_para_abrir: {
        Args: never;
        Returns: {
          email: string;
          na_fila: number;
        }[];
      };
      get_sdr_leads_para_abrir_v2: {
        Args: { p_org_id: string };
        Returns: {
          email: string;
          na_fila: number;
        }[];
      };
      hard_delete_lead: { Args: { p_lead: string }; Returns: string };
      increment_ai_usage: {
        Args: {
          p_default_limit: number;
          p_org_id: string;
          p_tokens: number;
          p_usage_date: string;
        };
        Returns: {
          out_count: number;
          out_limit: number;
        }[];
      };
      ingest_callface_call: { Args: { p_payload: Json }; Returns: Json };
      is_manager: { Args: never; Returns: boolean };
      lead_visibility_mode: { Args: never; Returns: string };
      leads_without_active_enrollment: {
        Args: { p_org_id: string };
        Returns: string[];
      };
      list_overdue_activities_brt: {
        Args: { p_cutoff: string; p_org_id: string };
        Returns: {
          assigned_to: string;
          enrollment_id: string;
          lead_id: string;
          step_id: string;
        }[];
      };
      list_overdue_enrollments_brt: {
        Args: { p_cutoff: string; p_org_id: string };
        Returns: {
          id: string;
        }[];
      };
      marcar_interacao_confirmacao: {
        Args: { p_telefone?: string; p_tipo: string; p_wamid: string };
        Returns: Json;
      };
      marcar_resposta_no_show: {
        Args: { p_resposta: string; p_telefone?: string; p_wamid: string };
        Returns: Json;
      };
      normalize_br_phone: { Args: { raw: string }; Returns: string };
      normalize_segmento: {
        Args: { p_org: string; p_val: string };
        Returns: Record<string, unknown>;
      };
      pode_enviar_confirmacao: {
        Args: {
          p_event_id: string;
          p_momento: string;
          p_pular_se_confirmado?: boolean;
        };
        Returns: Json;
      };
      push_calls_to_v4sales: {
        Args: { p_month?: number; p_year?: number };
        Returns: Json;
      };
      push_first_touch_to_v4sales: {
        Args: { p_apikey: string; p_batch?: number; p_from?: string };
        Returns: Json;
      };
      recalc_engagement_score: {
        Args: { p_lead_id: string };
        Returns: undefined;
      };
      registrar_disparo_no_show: {
        Args: {
          p_erro?: string;
          p_lead_id: string;
          p_meeting_starts_at: string;
          p_nome: string;
          p_telefone: string;
          p_toque?: number;
          p_wamid?: string;
        };
        Returns: number;
      };
      registrar_envio_confirmacao: {
        Args: {
          p_calendar_id: string;
          p_event_id: string;
          p_lead_id: string;
          p_link: string;
          p_momento: string;
          p_nome: string;
          p_responsavel: string;
          p_reuniao_em: string;
          p_sdr?: string;
          p_telefone: string;
          p_wamid?: string;
        };
        Returns: number;
      };
      registrar_novo_evento_no_show: {
        Args: { p_event_id: string; p_inicio: string; p_lead_id: string };
        Returns: Json;
      };
      registrar_qualidade_numero: {
        Args: {
          p_de: string;
          p_detalhe?: Json;
          p_evento: string;
          p_para: string;
          p_phone_number: string;
        };
        Returns: number;
      };
      registrar_status_mensagem:
        | { Args: { p_eventos: Json }; Returns: Json }
        | {
            Args: {
              p_display_phone_number?: string;
              p_eventos: Json;
              p_phone_number_id?: string;
            };
            Returns: Json;
          };
      set_primary_lead_contact: {
        Args: { p_contact_id: string };
        Returns: undefined;
      };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { '': string }; Returns: string[] };
      skip_weekend_brt: { Args: { ts: string }; Returns: string };
      sync_lead_meeting_starts_at: {
        Args: { p_lead_id: string };
        Returns: undefined;
      };
      update_call_from_webhook: {
        Args: {
          p_api4com_call_id: string;
          p_duration?: number;
          p_record_url?: string;
          p_started_at?: string;
        };
        Returns: {
          duration_seconds: number;
          id: string;
          lead_id: string;
          recording_url: string;
        }[];
      };
      user_org_id: { Args: never; Returns: string };
      verify_api_secret: {
        Args: { p_name: string; p_token: string };
        Returns: boolean;
      };
    };
    Enums: {
      cadence_status: 'draft' | 'active' | 'paused' | 'archived';
      call_disposition:
        | 'relevant_conversation'
        | 'answered_no_progress'
        | 'callback_requested'
        | 'no_answer'
        | 'technical_failure'
        | 'voicemail';
      call_status: 'significant' | 'not_significant' | 'no_contact' | 'busy' | 'not_connected';
      call_type: 'inbound' | 'outbound' | 'manual';
      channel_type:
        | 'email'
        | 'whatsapp'
        | 'phone'
        | 'linkedin'
        | 'research'
        | 'calendar'
        | 'system'
        | 'crm';
      closer_feedback_result: 'meeting_done' | 'no_show' | 'rescheduled';
      closer_qualificacao_aderencia: 'bateu' | 'divergiu' | 'nao_validado';
      connection_status: 'connected' | 'disconnected' | 'error' | 'syncing';
      crm_type: 'hubspot' | 'pipedrive' | 'rdstation' | 'kommo';
      enrichment_status: 'pending' | 'enriching' | 'enriched' | 'enrichment_failed' | 'not_found';
      enrollment_status: 'active' | 'paused' | 'completed' | 'replied' | 'bounced' | 'unsubscribed';
      import_status: 'processing' | 'completed' | 'failed';
      interaction_type:
        | 'sent'
        | 'delivered'
        | 'opened'
        | 'clicked'
        | 'replied'
        | 'bounced'
        | 'failed'
        | 'meeting_scheduled'
        | 'crm_synced'
        | 'crm_deal_created';
      lead_status: 'new' | 'contacted' | 'qualified' | 'won' | 'unqualified' | 'archived';
      member_role: 'manager' | 'sdr';
      member_status: 'invited' | 'active' | 'suspended' | 'removed';
      notification_type:
        | 'lead_replied'
        | 'lead_opened'
        | 'lead_clicked'
        | 'lead_bounced'
        | 'sync_completed'
        | 'integration_error'
        | 'member_invited'
        | 'member_joined'
        | 'usage_limit_alert'
        | 'trial_expiring'
        | 'activity_reminder'
        | 'meeting_reminder'
        | 'closer_feedback'
        | 'lead_won'
        | 'lead_lost'
        | 'import_completed'
        | 'goal_reached'
        | 'cadence_completed'
        | 'whatsapp_reply'
        | 'lead_inbound';
      subscription_status: 'active' | 'past_due' | 'canceled' | 'trialing';
      sync_direction: 'push' | 'pull';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      cadence_status: ['draft', 'active', 'paused', 'archived'],
      call_disposition: [
        'relevant_conversation',
        'answered_no_progress',
        'callback_requested',
        'no_answer',
        'technical_failure',
        'voicemail',
      ],
      call_status: ['significant', 'not_significant', 'no_contact', 'busy', 'not_connected'],
      call_type: ['inbound', 'outbound', 'manual'],
      channel_type: [
        'email',
        'whatsapp',
        'phone',
        'linkedin',
        'research',
        'calendar',
        'system',
        'crm',
      ],
      closer_feedback_result: ['meeting_done', 'no_show', 'rescheduled'],
      closer_qualificacao_aderencia: ['bateu', 'divergiu', 'nao_validado'],
      connection_status: ['connected', 'disconnected', 'error', 'syncing'],
      crm_type: ['hubspot', 'pipedrive', 'rdstation', 'kommo'],
      enrichment_status: ['pending', 'enriching', 'enriched', 'enrichment_failed', 'not_found'],
      enrollment_status: ['active', 'paused', 'completed', 'replied', 'bounced', 'unsubscribed'],
      import_status: ['processing', 'completed', 'failed'],
      interaction_type: [
        'sent',
        'delivered',
        'opened',
        'clicked',
        'replied',
        'bounced',
        'failed',
        'meeting_scheduled',
        'crm_synced',
        'crm_deal_created',
      ],
      lead_status: ['new', 'contacted', 'qualified', 'won', 'unqualified', 'archived'],
      member_role: ['manager', 'sdr'],
      member_status: ['invited', 'active', 'suspended', 'removed'],
      notification_type: [
        'lead_replied',
        'lead_opened',
        'lead_clicked',
        'lead_bounced',
        'sync_completed',
        'integration_error',
        'member_invited',
        'member_joined',
        'usage_limit_alert',
        'trial_expiring',
        'activity_reminder',
        'meeting_reminder',
        'closer_feedback',
        'lead_won',
        'lead_lost',
        'import_completed',
        'goal_reached',
        'cadence_completed',
        'whatsapp_reply',
        'lead_inbound',
      ],
      subscription_status: ['active', 'past_due', 'canceled', 'trialing'],
      sync_direction: ['push', 'pull'],
    },
  },
} as const;
