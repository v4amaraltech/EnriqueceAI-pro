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

export interface Api4ComPaginationMeta {
  totalItemCount?: number;
  totalPageCount?: number;
  itemsPerPage?: number;
  currentPage?: number;
  nextPage?: number | null;
  previousPage?: number | null;
}

// Paginated response from GET /calls. A API devolve a paginação em `meta`;
// `metadata` é o nome da documentação antiga e fica só como fallback.
// Leia sempre via `api4comPagination` / `api4comNextPage`.
export interface Api4ComCallListResponse {
  data: Api4ComCallRecord[];
  meta?: Api4ComPaginationMeta;
  /** @deprecated formato antigo; use `meta` (via api4comPagination). */
  metadata?: Api4ComPaginationMeta;
}

// Hangup causes do FreeSWITCH que a API4COM repassa e que o classificador
// (api4com-classification) ou o rótulo do webphone (hangupReasonLabel) conhecem.
// NUMBER_CHANGED e ALLOTTED_TIMEOUT seguem o guia oficial da API4COM
// ("caixa postal" e "tempo expirado"), não o sentido literal do FreeSWITCH.
export type Api4ComHangupCause =
  | 'NORMAL_CLEARING'
  | 'USER_BUSY'
  | 'BUSY'
  | 'NO_ANSWER'
  | 'NO_USER_RESPONSE'
  | 'MISSED'
  | 'CALL_REJECTED'
  | 'UNALLOCATED_NUMBER'
  | 'INVALID_NUMBER_FORMAT'
  | 'ORIGINATOR_CANCEL'
  | 'NORMAL_TEMPORARY_FAILURE'
  | 'RECOVERY_ON_TIMER_EXPIRE'
  | 'NETWORK_OUT_OF_ORDER'
  | 'EXCHANGE_ROUTING_ERROR'
  | 'VOICEMAIL'
  | 'NUMBER_CHANGED'
  | 'ALLOTTED_TIMEOUT';
