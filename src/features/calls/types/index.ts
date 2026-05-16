// Call status and type enums matching database
export type CallStatus = 'significant' | 'not_significant' | 'no_contact' | 'busy' | 'not_connected';
export type CallType = 'inbound' | 'outbound' | 'manual';
export type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

// Call row matching database table
export interface CallRow {
  id: string;
  org_id: string;
  user_id: string;
  lead_id: string | null;
  origin: string;
  destination: string;
  started_at: string;
  answered_at: string | null;
  duration_seconds: number;
  status: CallStatus;
  connected: boolean;
  hangup_cause: string | null;
  type: CallType;
  cost: number | null;
  recording_url: string | null;
  notes: string | null;
  is_important: boolean;
  metadata: Record<string, unknown> | null;
  transcription: string | null;
  transcription_status: TranscriptionStatus;
  transcription_error: string | null;
  created_at: string;
  updated_at: string;
}

// Call feedback row matching database table
export interface CallFeedbackRow {
  id: string;
  call_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

// Insert types
export interface CallInsert {
  org_id: string;
  user_id: string;
  lead_id?: string | null;
  origin: string;
  destination: string;
  started_at?: string;
  duration_seconds?: number;
  status?: CallStatus;
  type?: CallType;
  cost?: number | null;
  recording_url?: string | null;
  notes?: string | null;
  is_important?: boolean;
  metadata?: Record<string, string> | null;
}

// Call with detail (for modal)
export interface CallDetail extends CallRow {
  feedback: CallFeedbackRow[];
}

// Call Settings types matching database tables
export interface CallSettingsRow {
  id: string;
  org_id: string;
  calls_enabled: boolean;
  default_call_type: CallType;
  significant_threshold_seconds: number;
  daily_call_target: number;
  dialer_simultaneous_phones: number;
  dialer_daily_limit_per_lead: number;
  created_at: string;
  updated_at: string;
}

export interface CallDailyTargetRow {
  id: string;
  org_id: string;
  user_id: string;
  daily_target: number;
  created_at: string;
  updated_at: string;
}

export interface PhoneBlacklistRow {
  id: string;
  org_id: string;
  phone_pattern: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallSettingsData {
  settings: CallSettingsRow | null;
  dailyTargets: CallDailyTargetRow[];
  blacklist: PhoneBlacklistRow[];
}
