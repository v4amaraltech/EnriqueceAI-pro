export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_usage: {
        Row: {
          daily_limit: number
          generation_count: number
          id: string
          org_id: string
          usage_date: string
        }
        Insert: {
          daily_limit: number
          generation_count?: number
          id?: string
          org_id: string
          usage_date?: string
        }
        Update: {
          daily_limit?: number
          generation_count?: number
          id?: string
          org_id?: string
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_enrollments: {
        Row: {
          cadence_id: string
          completed_at: string | null
          current_step: number
          enrolled_at: string
          enrolled_by: string | null
          id: string
          lead_id: string
          loss_reason_id: string | null
          next_step_due: string | null
          status: Database["public"]["Enums"]["enrollment_status"]
          updated_at: string
        }
        Insert: {
          cadence_id: string
          completed_at?: string | null
          current_step?: number
          enrolled_at?: string
          enrolled_by?: string | null
          id?: string
          lead_id: string
          loss_reason_id?: string | null
          next_step_due?: string | null
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Update: {
          cadence_id?: string
          completed_at?: string | null
          current_step?: number
          enrolled_at?: string
          enrolled_by?: string | null
          id?: string
          lead_id?: string
          loss_reason_id?: string | null
          next_step_due?: string | null
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_enrollments_cadence_id_fkey"
            columns: ["cadence_id"]
            isOneToOne: false
            referencedRelation: "cadences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_enrollments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_enrollments_loss_reason_id_fkey"
            columns: ["loss_reason_id"]
            isOneToOne: false
            referencedRelation: "loss_reasons"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_steps: {
        Row: {
          ai_personalization: boolean
          cadence_id: string
          channel: Database["public"]["Enums"]["channel_type"]
          created_at: string
          delay_days: number
          delay_hours: number
          id: string
          step_order: number
          template_id: string | null
        }
        Insert: {
          ai_personalization?: boolean
          cadence_id: string
          channel: Database["public"]["Enums"]["channel_type"]
          created_at?: string
          delay_days?: number
          delay_hours?: number
          id?: string
          step_order: number
          template_id?: string | null
        }
        Update: {
          ai_personalization?: boolean
          cadence_id?: string
          channel?: Database["public"]["Enums"]["channel_type"]
          created_at?: string
          delay_days?: number
          delay_hours?: number
          id?: string
          step_order?: number
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cadence_steps_cadence_id_fkey"
            columns: ["cadence_id"]
            isOneToOne: false
            referencedRelation: "cadences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_steps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      cadences: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          org_id: string
          origin: string
          priority: string
          status: Database["public"]["Enums"]["cadence_status"]
          total_steps: number
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          org_id: string
          origin?: string
          priority?: string
          status?: Database["public"]["Enums"]["cadence_status"]
          total_steps?: number
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          origin?: string
          priority?: string
          status?: Database["public"]["Enums"]["cadence_status"]
          total_steps?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_connections: {
        Row: {
          access_token_encrypted: string
          calendar_email: string
          created_at: string
          id: string
          org_id: string
          refresh_token_encrypted: string
          status: Database["public"]["Enums"]["connection_status"]
          token_expires_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_encrypted: string
          calendar_email: string
          created_at?: string
          id?: string
          org_id: string
          refresh_token_encrypted: string
          status?: Database["public"]["Enums"]["connection_status"]
          token_expires_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_encrypted?: string
          calendar_email?: string
          created_at?: string
          id?: string
          org_id?: string
          refresh_token_encrypted?: string
          status?: Database["public"]["Enums"]["connection_status"]
          token_expires_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_daily_targets: {
        Row: {
          created_at: string
          daily_target: number
          id: string
          org_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_target?: number
          id?: string
          org_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_target?: number
          id?: string
          org_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_daily_targets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_feedback: {
        Row: {
          call_id: string
          content: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          call_id: string
          content: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          call_id?: string
          content?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_feedback_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          answered_at: string | null
          connected: boolean
          cost: number | null
          created_at: string
          destination: string
          duration_seconds: number
          hangup_cause: string | null
          id: string
          is_important: boolean
          lead_id: string | null
          notes: string | null
          org_id: string
          origin: string
          recording_url: string | null
          started_at: string
          status: Database["public"]["Enums"]["call_status"]
          type: Database["public"]["Enums"]["call_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          answered_at?: string | null
          connected?: boolean
          cost?: number | null
          created_at?: string
          destination: string
          duration_seconds?: number
          hangup_cause?: string | null
          id?: string
          is_important?: boolean
          lead_id?: string | null
          notes?: string | null
          org_id: string
          origin: string
          recording_url?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["call_status"]
          type?: Database["public"]["Enums"]["call_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          answered_at?: string | null
          connected?: boolean
          cost?: number | null
          created_at?: string
          destination?: string
          duration_seconds?: number
          hangup_cause?: string | null
          id?: string
          is_important?: boolean
          lead_id?: string | null
          notes?: string | null
          org_id?: string
          origin?: string
          recording_url?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["call_status"]
          type?: Database["public"]["Enums"]["call_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_connections: {
        Row: {
          created_at: string
          credentials_encrypted: Json
          crm_provider: Database["public"]["Enums"]["crm_type"]
          default_pipeline_id: string | null
          default_responsible_user_id: string | null
          default_stage_id: string | null
          field_mapping: Json | null
          id: string
          last_sync_at: string | null
          org_id: string
          status: Database["public"]["Enums"]["connection_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          credentials_encrypted: Json
          crm_provider: Database["public"]["Enums"]["crm_type"]
          default_pipeline_id?: string | null
          default_responsible_user_id?: string | null
          default_stage_id?: string | null
          field_mapping?: Json | null
          id?: string
          last_sync_at?: string | null
          org_id: string
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          credentials_encrypted?: Json
          crm_provider?: Database["public"]["Enums"]["crm_type"]
          default_pipeline_id?: string | null
          default_responsible_user_id?: string | null
          default_stage_id?: string | null
          field_mapping?: Json | null
          id?: string
          last_sync_at?: string | null
          org_id?: string
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sync_log: {
        Row: {
          connection_id: string
          created_at: string
          direction: Database["public"]["Enums"]["sync_direction"]
          duration_ms: number | null
          error_details: Json | null
          errors: number
          id: string
          records_synced: number
        }
        Insert: {
          connection_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["sync_direction"]
          duration_ms?: number | null
          error_details?: Json | null
          errors?: number
          id?: string
          records_synced?: number
        }
        Update: {
          connection_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["sync_direction"]
          duration_ms?: number | null
          error_details?: Json | null
          errors?: number
          id?: string
          records_synced?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_sync_log_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "crm_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          created_at: string
          field_name: string
          field_type: string
          id: string
          options: Json | null
          org_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          field_name: string
          field_type: string
          id?: string
          options?: Json | null
          org_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          field_name?: string
          field_type?: string
          id?: string
          options?: Json | null
          org_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_activity_goals: {
        Row: {
          created_at: string
          id: string
          org_id: string
          target: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          target?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          target?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_activity_goals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_blacklist: {
        Row: {
          created_at: string
          domain: string
          id: string
          org_id: string
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          org_id: string
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_blacklist_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_attempts: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          lead_id: string
          provider: string
          response_data: Json | null
          status: Database["public"]["Enums"]["enrichment_status"]
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          lead_id: string
          provider: string
          response_data?: Json | null
          status: Database["public"]["Enums"]["enrichment_status"]
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          lead_id?: string
          provider?: string
          response_data?: Json | null
          status?: Database["public"]["Enums"]["enrichment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_attempts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      fit_score_rules: {
        Row: {
          created_at: string
          field: string
          id: string
          operator: string
          org_id: string
          points: number
          sort_order: number
          value: string | null
        }
        Insert: {
          created_at?: string
          field: string
          id?: string
          operator: string
          org_id: string
          points: number
          sort_order?: number
          value?: string | null
        }
        Update: {
          created_at?: string
          field?: string
          id?: string
          operator?: string
          org_id?: string
          points?: number
          sort_order?: number
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fit_score_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gmail_connections: {
        Row: {
          access_token_encrypted: string
          created_at: string
          custom_signature: string | null
          email_address: string
          id: string
          org_id: string
          refresh_token_encrypted: string
          status: Database["public"]["Enums"]["connection_status"]
          token_expires_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_encrypted: string
          created_at?: string
          custom_signature?: string | null
          email_address: string
          id?: string
          org_id: string
          refresh_token_encrypted: string
          status?: Database["public"]["Enums"]["connection_status"]
          token_expires_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_encrypted?: string
          created_at?: string
          custom_signature?: string | null
          email_address?: string
          id?: string
          org_id?: string
          refresh_token_encrypted?: string
          status?: Database["public"]["Enums"]["connection_status"]
          token_expires_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gmail_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          activities_target: number
          conversion_target: number
          created_at: string
          created_by: string
          id: string
          month: string
          opportunity_target: number
          org_id: string
          updated_at: string
        }
        Insert: {
          activities_target?: number
          conversion_target?: number
          created_at?: string
          created_by: string
          id?: string
          month: string
          opportunity_target?: number
          org_id: string
          updated_at?: string
        }
        Update: {
          activities_target?: number
          conversion_target?: number
          created_at?: string
          created_by?: string
          id?: string
          month?: string
          opportunity_target?: number
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      goals_per_user: {
        Row: {
          activities_target: number
          conversion_target: number
          created_at: string
          id: string
          meetings_held_target: number
          meetings_scheduled_target: number
          month: string
          opportunity_target: number
          org_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activities_target?: number
          conversion_target?: number
          created_at?: string
          id?: string
          meetings_held_target?: number
          meetings_scheduled_target?: number
          month: string
          opportunity_target?: number
          org_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activities_target?: number
          conversion_target?: number
          created_at?: string
          id?: string
          meetings_held_target?: number
          meetings_scheduled_target?: number
          month?: string
          opportunity_target?: number
          org_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_per_user_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      interactions: {
        Row: {
          ai_generated: boolean
          cadence_id: string | null
          channel: Database["public"]["Enums"]["channel_type"]
          created_at: string
          external_id: string | null
          id: string
          lead_id: string
          message_content: string | null
          metadata: Json | null
          org_id: string
          original_template_id: string | null
          step_id: string | null
          type: Database["public"]["Enums"]["interaction_type"]
        }
        Insert: {
          ai_generated?: boolean
          cadence_id?: string | null
          channel: Database["public"]["Enums"]["channel_type"]
          created_at?: string
          external_id?: string | null
          id?: string
          lead_id: string
          message_content?: string | null
          metadata?: Json | null
          org_id: string
          original_template_id?: string | null
          step_id?: string | null
          type: Database["public"]["Enums"]["interaction_type"]
        }
        Update: {
          ai_generated?: boolean
          cadence_id?: string | null
          channel?: Database["public"]["Enums"]["channel_type"]
          created_at?: string
          external_id?: string | null
          id?: string
          lead_id?: string
          message_content?: string | null
          metadata?: Json | null
          org_id?: string
          original_template_id?: string | null
          step_id?: string | null
          type?: Database["public"]["Enums"]["interaction_type"]
        }
        Relationships: [
          {
            foreignKeyName: "interactions_cadence_id_fkey"
            columns: ["cadence_id"]
            isOneToOne: false
            referencedRelation: "cadences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_original_template_id_fkey"
            columns: ["original_template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "cadence_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_import_errors: {
        Row: {
          cnpj: string | null
          created_at: string
          error_message: string
          id: string
          import_id: string
          row_number: number
        }
        Insert: {
          cnpj?: string | null
          created_at?: string
          error_message: string
          id?: string
          import_id: string
          row_number: number
        }
        Update: {
          cnpj?: string | null
          created_at?: string
          error_message?: string
          id?: string
          import_id?: string
          row_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_import_errors_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "lead_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_imports: {
        Row: {
          created_at: string
          created_by: string | null
          error_count: number
          file_name: string
          id: string
          org_id: string
          processed_rows: number
          status: Database["public"]["Enums"]["import_status"]
          success_count: number
          total_rows: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_count?: number
          file_name: string
          id?: string
          org_id: string
          processed_rows?: number
          status?: Database["public"]["Enums"]["import_status"]
          success_count?: number
          total_rows?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_count?: number
          file_name?: string
          id?: string
          org_id?: string
          processed_rows?: number
          status?: Database["public"]["Enums"]["import_status"]
          success_count?: number
          total_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_imports_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          cnae: string | null
          cnpj: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          email: string | null
          endereco: Json | null
          enriched_at: string | null
          enrichment_status: Database["public"]["Enums"]["enrichment_status"]
          faturamento_estimado: number | null
          fit_score: number | null
          id: string
          import_id: string | null
          nome_fantasia: string | null
          notes: string | null
          org_id: string
          porte: string | null
          razao_social: string | null
          situacao_cadastral: string | null
          socios: Json | null
          status: Database["public"]["Enums"]["lead_status"]
          telefone: string | null
          updated_at: string
        }
        Insert: {
          cnae?: string | null
          cnpj: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          endereco?: Json | null
          enriched_at?: string | null
          enrichment_status?: Database["public"]["Enums"]["enrichment_status"]
          faturamento_estimado?: number | null
          fit_score?: number | null
          id?: string
          import_id?: string | null
          nome_fantasia?: string | null
          notes?: string | null
          org_id: string
          porte?: string | null
          razao_social?: string | null
          situacao_cadastral?: string | null
          socios?: Json | null
          status?: Database["public"]["Enums"]["lead_status"]
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          cnae?: string | null
          cnpj?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          endereco?: Json | null
          enriched_at?: string | null
          enrichment_status?: Database["public"]["Enums"]["enrichment_status"]
          faturamento_estimado?: number | null
          fit_score?: number | null
          id?: string
          import_id?: string | null
          nome_fantasia?: string | null
          notes?: string | null
          org_id?: string
          porte?: string | null
          razao_social?: string | null
          situacao_cadastral?: string | null
          socios?: Json | null
          status?: Database["public"]["Enums"]["lead_status"]
          telefone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "lead_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loss_reasons: {
        Row: {
          created_at: string
          id: string
          is_system: boolean
          name: string
          org_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          org_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          org_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "loss_reasons_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          channel: Database["public"]["Enums"]["channel_type"]
          created_at: string
          created_by: string | null
          id: string
          is_system: boolean
          name: string
          org_id: string
          subject: string | null
          updated_at: string
          variables_used: string[] | null
        }
        Insert: {
          body: string
          channel: Database["public"]["Enums"]["channel_type"]
          created_at?: string
          created_by?: string | null
          id?: string
          is_system?: boolean
          name: string
          org_id: string
          subject?: string | null
          updated_at?: string
          variables_used?: string[] | null
        }
        Update: {
          body?: string
          channel?: Database["public"]["Enums"]["channel_type"]
          created_at?: string
          created_by?: string | null
          id?: string
          is_system?: boolean
          name?: string
          org_id?: string
          subject?: string | null
          updated_at?: string
          variables_used?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          metadata: Json
          org_id: string
          read_at: string | null
          resource_id: string | null
          resource_type: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id: string
          read_at?: string | null
          resource_id?: string | null
          resource_type?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string
          read_at?: string | null
          resource_id?: string | null
          resource_type?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_call_settings: {
        Row: {
          calls_enabled: boolean
          created_at: string
          daily_call_target: number
          default_call_type: Database["public"]["Enums"]["call_type"]
          id: string
          org_id: string
          significant_threshold_seconds: number
          updated_at: string
        }
        Insert: {
          calls_enabled?: boolean
          created_at?: string
          daily_call_target?: number
          default_call_type?: Database["public"]["Enums"]["call_type"]
          id?: string
          org_id: string
          significant_threshold_seconds?: number
          updated_at?: string
        }
        Update: {
          calls_enabled?: boolean
          created_at?: string
          daily_call_target?: number
          default_call_type?: Database["public"]["Enums"]["call_type"]
          id?: string
          org_id?: string
          significant_threshold_seconds?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_call_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          invited_at: string
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          abm_enabled: boolean
          abm_group_field: string
          created_at: string
          id: string
          lead_visibility_mode: string
          name: string
          owner_id: string
          slug: string
          stripe_customer_id: string | null
          updated_at: string
        }
        Insert: {
          abm_enabled?: boolean
          abm_group_field?: string
          created_at?: string
          id?: string
          lead_visibility_mode?: string
          name: string
          owner_id: string
          slug: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          abm_enabled?: boolean
          abm_group_field?: string
          created_at?: string
          id?: string
          lead_visibility_mode?: string
          name?: string
          owner_id?: string
          slug?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      phone_blacklist: {
        Row: {
          created_at: string
          id: string
          org_id: string
          phone_pattern: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          phone_pattern: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          phone_pattern?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_blacklist_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          active: boolean
          additional_user_price_cents: number
          created_at: string
          features: Json
          id: string
          included_users: number
          max_ai_per_day: number
          max_leads: number
          max_whatsapp_per_month: number
          name: string
          price_cents: number
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          additional_user_price_cents: number
          created_at?: string
          features?: Json
          id?: string
          included_users?: number
          max_ai_per_day: number
          max_leads: number
          max_whatsapp_per_month: number
          name: string
          price_cents: number
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          additional_user_price_cents?: number
          created_at?: string
          features?: Json
          id?: string
          included_users?: number
          max_ai_per_day?: number
          max_leads?: number
          max_whatsapp_per_month?: number
          name?: string
          price_cents?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          org_id: string
          plan_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          org_id: string
          plan_id: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          org_id?: string
          plan_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          event_id: string
          event_type: string
          id: string
          payload: Json | null
          processed_at: string | null
          provider: string
        }
        Insert: {
          event_id: string
          event_type: string
          id?: string
          payload?: Json | null
          processed_at?: string | null
          provider: string
        }
        Update: {
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json | null
          processed_at?: string | null
          provider?: string
        }
        Relationships: []
      }
      whatsapp_connections: {
        Row: {
          access_token_encrypted: string
          business_account_id: string
          created_at: string
          id: string
          org_id: string
          phone_number_id: string
          status: Database["public"]["Enums"]["connection_status"]
          updated_at: string
        }
        Insert: {
          access_token_encrypted: string
          business_account_id: string
          created_at?: string
          id?: string
          org_id: string
          phone_number_id: string
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
        }
        Update: {
          access_token_encrypted?: string
          business_account_id?: string
          created_at?: string
          id?: string
          org_id?: string
          phone_number_id?: string
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_credits: {
        Row: {
          id: string
          org_id: string
          overage_count: number
          period: string
          plan_credits: number
          used_credits: number
        }
        Insert: {
          id?: string
          org_id: string
          overage_count?: number
          period: string
          plan_credits?: number
          used_credits?: number
        }
        Update: {
          id?: string
          org_id?: string
          overage_count?: number
          period?: string
          plan_credits?: number
          used_credits?: number
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_credits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_manager: { Args: never; Returns: boolean }
      user_org_id: { Args: never; Returns: string }
      get_distinct_lead_canais: { Args: never; Returns: { canal: string }[] }
      get_distinct_lead_cnaes: { Args: never; Returns: { cnae: string }[] }
    }
    Enums: {
      cadence_status: "draft" | "active" | "paused" | "archived"
      call_status:
        | "significant"
        | "not_significant"
        | "no_contact"
        | "busy"
        | "not_connected"
      call_type: "inbound" | "outbound" | "manual"
      channel_type: "email" | "whatsapp" | "phone" | "linkedin" | "research"
      connection_status: "connected" | "disconnected" | "error" | "syncing"
      crm_type: "hubspot" | "pipedrive" | "rdstation"
      enrichment_status:
        | "pending"
        | "enriching"
        | "enriched"
        | "enrichment_failed"
        | "not_found"
      enrollment_status:
        | "active"
        | "paused"
        | "completed"
        | "replied"
        | "bounced"
        | "unsubscribed"
      import_status: "processing" | "completed" | "failed"
      interaction_type:
        | "sent"
        | "delivered"
        | "opened"
        | "clicked"
        | "replied"
        | "bounced"
        | "failed"
        | "meeting_scheduled"
      lead_status:
        | "new"
        | "contacted"
        | "qualified"
        | "unqualified"
        | "archived"
      member_role: "manager" | "sdr"
      member_status: "invited" | "active" | "suspended" | "removed"
      notification_type:
        | "lead_replied"
        | "lead_opened"
        | "lead_clicked"
        | "lead_bounced"
        | "sync_completed"
        | "integration_error"
        | "member_invited"
        | "member_joined"
        | "usage_limit_alert"
      subscription_status: "active" | "past_due" | "canceled" | "trialing"
      sync_direction: "push" | "pull"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      cadence_status: ["draft", "active", "paused", "archived"],
      call_status: [
        "significant",
        "not_significant",
        "no_contact",
        "busy",
        "not_connected",
      ],
      call_type: ["inbound", "outbound", "manual"],
      channel_type: ["email", "whatsapp", "phone", "linkedin", "research"],
      connection_status: ["connected", "disconnected", "error", "syncing"],
      crm_type: ["hubspot", "pipedrive", "rdstation"],
      enrichment_status: [
        "pending",
        "enriching",
        "enriched",
        "enrichment_failed",
        "not_found",
      ],
      enrollment_status: [
        "active",
        "paused",
        "completed",
        "replied",
        "bounced",
        "unsubscribed",
      ],
      import_status: ["processing", "completed", "failed"],
      interaction_type: [
        "sent",
        "delivered",
        "opened",
        "clicked",
        "replied",
        "bounced",
        "failed",
        "meeting_scheduled",
      ],
      lead_status: ["new", "contacted", "qualified", "unqualified", "archived"],
      member_role: ["manager", "sdr"],
      member_status: ["invited", "active", "suspended", "removed"],
      notification_type: [
        "lead_replied",
        "lead_opened",
        "lead_clicked",
        "lead_bounced",
        "sync_completed",
        "integration_error",
        "member_invited",
        "member_joined",
        "usage_limit_alert",
      ],
      subscription_status: ["active", "past_due", "canceled", "trialing"],
      sync_direction: ["push", "pull"],
    },
  },
} as const

