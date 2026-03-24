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

// 3CPlus API standard response wrapper
export interface ThreeCPlusApiResponse<T> {
  status: number;
  title?: string;
  detail?: string;
  transaction_id?: string;
  data: T;
}

// 3CPlus API types
export interface ThreeCPlusAuthData {
  api_token: string;
  user: {
    id: number;
    name: string;
    email: string;
  };
}

export type ThreeCPlusAuthResponse = ThreeCPlusApiResponse<ThreeCPlusAuthData>;

export interface ThreeCPlusCampaign {
  id: number;
  name: string;
  status: string;
}

export type ThreeCPlusCampaignsResponse = ThreeCPlusApiResponse<ThreeCPlusCampaign[]>;

export interface ThreeCPlusManualCallResponse {
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
  | 'logged_out'
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
