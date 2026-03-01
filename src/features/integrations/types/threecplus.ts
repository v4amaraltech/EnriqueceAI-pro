import type { ConnectionStatus } from './index';

// 3CPlus connection row matching database table
export interface ThreeCPlusConnectionRow {
  id: string;
  org_id: string;
  user_id: string;
  extension: string;
  api_token_encrypted: string | null;
  base_url: string;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

// Safe version for client (without encrypted token)
export interface ThreeCPlusConnectionSafe {
  id: string;
  extension: string;
  base_url: string;
  has_api_token: boolean;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

// Response from POST /click2call
export interface ThreeCPlusClick2CallResponse {
  id: string;
  status: string;
  message?: string;
}

// Response from POST /agent/call/{id}/hangup
export interface ThreeCPlusHangupResponse {
  status: string;
  message?: string;
}

// Call record from GET /calls
export interface ThreeCPlusCallRecord {
  id: string;
  phone: string;
  extension: string;
  started_at: string;
  ended_at: string | null;
  duration: number;
  status: string;
}

// Paginated response from GET /calls
export interface ThreeCPlusCallListResponse {
  data: ThreeCPlusCallRecord[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}
