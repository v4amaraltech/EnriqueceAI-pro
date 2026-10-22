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
  /** SIP domain stored on this user's row. Null if the SDR hasn't filled it. */
  sip_domain: string | null;
  /** SIP domain inferred from the org. Used as default in the config modal so
   *  SDRs don't need to discover it manually. */
  org_sip_domain: string | null;
  has_api_key: boolean;
  has_sip_password: boolean;
  /** A org tem token da conta: o ramal é gerido pelo gestor e o SDR não desconecta. */
  org_managed: boolean;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

// API4Com account settings (per org): one token for every ramal of the org.
export interface Api4ComOrgSettingsSafe {
  configured: boolean;
  base_url: string | null;
  sip_domain: string | null;
  last_synced_at: string | null;
}

export interface Api4ComTeamMember {
  userId: string;
  name: string;
  email: string | null;
  role: 'manager' | 'sdr';
  ramal: string | null;
  hasSipPassword: boolean;
  syncedAt: string | null;
  /** Token legado cadastrado na própria linha do usuário. */
  hasOwnToken: boolean;
  /** Webphone no navegador liberado pelo gestor para esta pessoa (bloco 2). */
  webphoneEnabled: boolean;
}

export interface Api4ComOrgOverview {
  settings: Api4ComOrgSettingsSafe;
  team: Api4ComTeamMember[];
}

export interface Api4ComSyncPerson {
  userId: string;
  name: string;
  email: string | null;
}

export interface Api4ComSyncReport {
  /** Linhas existentes casadas pelo ramal (domínio/senha completados). */
  linked: Array<Api4ComSyncPerson & { ramal: string }>;
  /** Usuários que ganharam ramal pelo e-mail. */
  created: Array<Api4ComSyncPerson & { ramal: string }>;
  /** Linhas cujo ramal não existe mais na conta. */
  missing: Array<Api4ComSyncPerson & { ramal: string }>;
  /** Mais de um ramal para o e-mail — o gestor escolhe. */
  ambiguous: Array<Api4ComSyncPerson & { ramais: string[] }>;
  /** Sem ramal na conta (ou sem e-mail). */
  unmatched: Api4ComSyncPerson[];
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
