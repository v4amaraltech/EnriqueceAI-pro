// Connection status enum matching database
export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'syncing';

// Gmail connection row matching database table
export interface GmailConnectionRow {
  id: string;
  org_id: string;
  user_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string;
  email_address: string;
  custom_signature: string | null;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

// WhatsApp connection row matching database table
export interface WhatsAppConnectionRow {
  id: string;
  org_id: string;
  phone_number_id: string;
  business_account_id: string;
  access_token_encrypted: string;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

// Calendar connection row matching database table
export interface CalendarConnectionRow {
  id: string;
  org_id: string;
  user_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string;
  calendar_email: string;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

// Safe versions for client (without encrypted tokens)
export interface GmailConnectionSafe {
  id: string;
  email_address: string;
  custom_signature: string | null;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppConnectionSafe {
  id: string;
  phone_number_id: string;
  business_account_id: string;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

export interface CalendarConnectionSafe {
  id: string;
  calendar_email: string;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

// API4Com (VoIP) connection row matching database table
export interface Api4ComConnectionRow {
  id: string;
  org_id: string;
  user_id: string;
  api_key_encrypted: string | null;
  ramal: string;
  base_url: string;
  sip_domain: string | null;
  sip_password_encrypted: string | null;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

export interface Api4ComConnectionSafe {
  id: string;
  ramal: string;
  base_url: string;
  sip_domain: string | null;
  has_api_key: boolean;
  has_sip_password: boolean;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

// Apollo connection (per org)
export interface ApolloConnectionSafe {
  id: string;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

// WhatsApp Evolution instance (from whatsapp_instances table)
export interface WhatsAppEvolutionInstanceSafe {
  id: string;
  instance_name: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  phone: string | null;
  created_at: string;
  updated_at: string;
}

// Evolution API WhatsApp instance status
export type EvolutionStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'not_configured';

export interface EvolutionCreateResponse {
  instance_name: string;
  qr_base64: string | null;
  status: EvolutionStatus;
  phone?: string;
  message?: string;
  last_error?: string;
}

export interface EvolutionStatusResponse {
  status: EvolutionStatus;
  phone: string | null;
  instance_name?: string;
  qr_base64?: string | null;
  message?: string;
}

export interface EvolutionQrResponse {
  qr_base64: string | null;
  status: EvolutionStatus;
  instance_name?: string;
  phone?: string;
  message?: string;
}

// Re-export CRM types
export type {
  CrmProvider,
  SyncDirection,
  CrmConnectionRow,
  CrmConnectionSafe,
  CrmSyncLogRow,
  SyncErrorDetail,
  CrmCredentials,
  FieldMapping,
  SyncResult,
  CrmContact,
  CrmActivity,
  CRMAdapter,
} from './crm';
export { DEFAULT_FIELD_MAPPINGS } from './crm';
