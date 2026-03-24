import type { ConnectionStatus } from './index';

// Database row for threecplus_connections
export interface ThreeCPlusConnectionRow {
  id: string;
  org_id: string;
  user_id: string;
  login: string;
  api_token_encrypted: string | null;
  domain: string;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

// Safe version for client (without encrypted token)
export interface ThreeCPlusConnectionSafe {
  id: string;
  login: string;
  domain: string;
  has_api_token: boolean;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

// 3CPlus API types
export interface ThreeCPlusAuthResponse {
  token: string;
  user: {
    id: number;
    name: string;
    email: string;
  };
}

export interface ThreeCPlusCampaign {
  id: number;
  name: string;
  status: string;
}

export interface ThreeCPlusCampaignsResponse {
  data: ThreeCPlusCampaign[];
}

export interface ThreeCPlusAgentLoginResponse {
  success: boolean;
  message?: string;
}

export interface ThreeCPlusManualCallResponse {
  success: boolean;
  call_id?: string;
  message?: string;
}

// Socket.io event types
export type ThreeCPlusAgentStatus =
  | 'idle'
  | 'connected'
  | 'acw'
  | 'manual_mode'
  | 'work_break'
  | 'login_failed'
  | 'disconnected';

export interface ThreeCPlusSocketCallData {
  callId: string;
  phone: string;
  qualifications: ThreeCPlusQualification[];
  mailingData?: Record<string, unknown>;
}

export interface ThreeCPlusQualification {
  id: number;
  name: string;
  shortcut?: string;
}
