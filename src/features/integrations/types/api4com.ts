// API4COM webhook payload for channel-hangup event
export interface Api4ComWebhookPayload {
  version: string;
  eventType: 'channel-hangup' | 'channel-answer';
  id: string;
  domain: string;
  direction: 'inbound' | 'outbound';
  caller: string;
  called: string;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string;
  duration: number;
  hangupCause: string;
  hangupCauseCode: string;
  recordUrl: string | null;
  metadata: Record<string, string>;
}

// Response from POST /calls (same `id` as the call list and the webhook events;
// the deprecated POST /dialer returned a different id)
export interface Api4ComOriginateResponse {
  status?: string;
  id: string;
  message: string;
}

// Response from POST /calls/{id}/hangup
export interface Api4ComHangupResponse {
  status: string;
  message: string;
  id: string;
}

// Single call record from GET /calls
export interface Api4ComCallRecord {
  id: string;
  domain: string;
  call_type: string;
  started_at: string;
  ended_at: string;
  from: string;
  to: string;
  duration: number;
  hangup_cause: string;
  record_url: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  BINA: string | null;
  minute_price: number | null;
  call_price: number | null;
  metadata: Record<string, string>;
}

// Paginated response from GET /calls
export interface Api4ComCallListResponse {
  data: Api4ComCallRecord[];
  metadata: {
    totalItemCount: number;
    totalPageCount: number;
    itemsPerPage: number;
    currentPage: number;
    nextPage: number | null;
    previousPage: number | null;
  };
}

// Common hangup causes from FreeSWITCH
export type Api4ComHangupCause =
  | 'NORMAL_CLEARING'
  | 'USER_BUSY'
  | 'NO_ANSWER'
  | 'NO_USER_RESPONSE'
  | 'CALL_REJECTED'
  | 'UNALLOCATED_NUMBER'
  | 'INVALID_NUMBER_FORMAT'
  | 'ORIGINATOR_CANCEL'
  | 'NORMAL_TEMPORARY_FAILURE'
  | 'RECOVERY_ON_TIMER_EXPIRE';
