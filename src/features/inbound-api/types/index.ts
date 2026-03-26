export interface ApiKeyRow {
  id: string;
  org_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKeySafe {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface InboundLeadResult {
  index: number;
  status: 'created' | 'duplicate' | 'updated' | 'error';
  lead_id?: string;
  existing_lead_id?: string;
  error?: string;
}

export interface InboundBatchResult {
  received: number;
  created: number;
  duplicates: number;
  updated: number;
  errors: number;
  results: InboundLeadResult[];
}
