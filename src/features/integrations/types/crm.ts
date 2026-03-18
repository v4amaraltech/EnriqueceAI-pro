// CRM-specific types matching database schema

import type { ConnectionStatus } from './index';

// CRM provider enum matching database crm_type
export type CrmProvider = 'hubspot' | 'pipedrive' | 'rdstation';

// Sync direction matching database sync_direction
export type SyncDirection = 'push' | 'pull';

// CRM connection row matching database table
export interface CrmConnectionRow {
  id: string;
  org_id: string;
  crm_provider: CrmProvider;
  credentials_encrypted: string;
  field_mapping: FieldMapping | null;
  status: ConnectionStatus;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

// Safe version for client (without encrypted credentials)
export interface CrmConnectionSafe {
  id: string;
  crm_provider: CrmProvider;
  field_mapping: FieldMapping | null;
  status: ConnectionStatus;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

// CRM sync log row matching database table
export interface CrmSyncLogRow {
  id: string;
  connection_id: string;
  direction: SyncDirection;
  records_synced: number;
  errors: number;
  duration_ms: number | null;
  error_details: SyncErrorDetail[] | null;
  created_at: string;
}

// Sync error detail stored in JSONB
export interface SyncErrorDetail {
  record_id: string;
  message: string;
  field?: string;
}

// Encrypted credentials stored in JSONB
export interface CrmCredentials {
  access_token: string;
  refresh_token?: string;
  token_expires_at?: string;
  portal_id?: string; // HubSpot portal ID
  api_key?: string; // Alternative auth
}

// Field mapping: EnriqueceAI field name -> CRM field name
export interface FieldMapping {
  leads: Record<string, string>;
  activities?: Record<string, string>;
}

// Default field mappings per provider
export const DEFAULT_FIELD_MAPPINGS: Record<CrmProvider, FieldMapping> = {
  hubspot: {
    leads: {
      nome_fantasia: 'company',
      razao_social: 'lastname',
      email: 'email',
      telefone: 'phone',
    },
    activities: {
      channel: 'hs_activity_type',
      message_content: 'hs_body_preview',
      type: 'hs_engagement_type',
    },
  },
  pipedrive: {
    leads: {
      nome_fantasia: 'name',
      email: 'email',
      telefone: 'phone',
    },
  },
  rdstation: {
    leads: {
      email: 'email',
      telefone: 'phone',
    },
  },
};

// Sync result returned by adapter sync methods
export interface SyncResult {
  synced: number;
  errors: number;
  errorDetails: SyncErrorDetail[];
}

// CRM contact representation (normalized across providers)
export interface CrmContact {
  external_id: string;
  email: string | null;
  company_name: string | null;
  phone: string | null;
  properties: Record<string, string | null>;
  updated_at: string;
}

// CRM activity representation (normalized)
export interface CrmActivity {
  external_id: string;
  type: string;
  subject: string | null;
  body: string | null;
  contact_id: string;
  timestamp: string;
}

// CRM pipeline/stage for deal creation (Pipedrive-specific)
export interface CrmPipeline {
  id: string;
  name: string;
  stages: CrmStage[];
}

export interface CrmStage {
  id: string;
  name: string;
}

// Abstract CRM adapter interface
export interface CRMAdapter {
  readonly provider: CrmProvider;

  // OAuth flow
  getAuthUrl(redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<CrmCredentials>;
  refreshToken(credentials: CrmCredentials): Promise<CrmCredentials>;

  // Lead/Contact sync
  pullContacts(
    credentials: CrmCredentials,
    since?: string,
  ): Promise<CrmContact[]>;
  pushContact(
    credentials: CrmCredentials,
    lead: Record<string, string | null>,
    fieldMapping: Record<string, string>,
    externalId?: string,
  ): Promise<{ external_id: string }>;

  // Activity sync
  pushActivity(
    credentials: CrmCredentials,
    activity: {
      contact_external_id: string;
      type: string;
      subject: string;
      body: string;
      timestamp: string;
    },
  ): Promise<{ external_id: string }>;

  // Validation
  validateConnection(credentials: CrmCredentials): Promise<boolean>;
}
