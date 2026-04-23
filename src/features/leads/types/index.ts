// Lead status enums matching database
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'unqualified' | 'archived';
export type EnrichmentStatus = 'pending' | 'enriching' | 'enriched' | 'enrichment_failed' | 'not_found';
export type ImportStatus = 'processing' | 'completed' | 'failed';
export type EnrichmentProvider = 'cnpj_ws' | 'lemit' | 'apollo';

// Phone entry stored in phones JSONB array
export interface LeadPhone {
  tipo: 'celular' | 'fixo' | 'whatsapp';
  numero: string;
}

// Email entry stored in emails JSONB array
export interface LeadEmail {
  tipo: 'corporativo' | 'pessoal';
  email: string;
}

// Lead address (stored as JSONB)
export interface LeadAddress {
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
}

// Lead partner/socio (stored as JSONB array)
export interface LeadSocio {
  nome: string;
  qualificacao?: string;
  cpf_masked?: string;
  cpf?: string;
  participacao?: number;
  capital_social?: number;
  // CPF enrichment data (step 2)
  emails?: Array<{ email: string; ranking: number }>;
  celulares?: Array<{ ddd: number; numero: string; whatsapp: boolean; ranking: number }>;
  endereco?: { endereco: string; bairro: string; cidade: string; uf: string; cep: string };
  cpf_enrichment_status?: 'pending' | 'enriched' | 'failed';
}

// Lead row matching database table
export interface LeadRow {
  id: string;
  org_id: string;
  cnpj: string | null;
  status: LeadStatus;
  enrichment_status: EnrichmentStatus;
  razao_social: string | null;
  nome_fantasia: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  lead_source: string | null;
  canal: string | null;
  segmento?: string | null;
  source_id: string | null;
  is_inbound: boolean;
  endereco: LeadAddress | null;
  porte: string | null;
  cnae: string | null;
  situacao_cadastral: string | null;
  email: string | null;
  emails: LeadEmail[] | null;
  telefone: string | null;
  phones: LeadPhone[] | null;
  socios: LeadSocio[] | null;
  faturamento_estimado: number | null;
  notes: string | null;
  instagram: string | null;
  linkedin: string | null;
  website: string | null;
  fit_score: number | null;
  engagement_score: number | null;
  enriched_at: string | null;
  custom_field_values: Record<string, string> | null;
  email_bounced_at: string | null;
  created_by: string | null;
  assigned_to: string | null;
  import_id: string | null;
  closer_id: string | null;
  won_by: string | null;
  contacted_at: string | null;
  qualified_at: string | null;
  meeting_scheduled_at: string | null;
  archived_at: string | null;
  won_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

// Lead import row matching database table
export interface LeadImportRow {
  id: string;
  org_id: string;
  file_name: string;
  total_rows: number;
  processed_rows: number;
  success_count: number;
  error_count: number;
  status: ImportStatus;
  lead_source: string | null;
  created_by: string | null;
  created_at: string;
}

// Lead import error row matching database table
export interface LeadImportErrorRow {
  id: string;
  import_id: string;
  row_number: number;
  cnpj: string | null;
  error_message: string;
  created_at: string;
}

// Enrichment attempt row matching database table
export interface EnrichmentAttemptRow {
  id: string;
  lead_id: string;
  provider: EnrichmentProvider;
  status: EnrichmentStatus;
  response_data: Record<string, unknown> | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

// Cadence info for list view
export interface LeadCadenceInfo {
  cadence_name: string | null;
  responsible_email: string | null;
  enrollment_status: 'active' | 'paused' | null;
}

// Insert types (without auto-generated fields)
export interface LeadInsert {
  org_id: string;
  cnpj?: string | null;
  status?: LeadStatus;
  enrichment_status?: EnrichmentStatus;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  job_title?: string | null;
  lead_source?: string | null;
  canal?: string | null;
  source_id?: string | null;
  is_inbound?: boolean;
  endereco?: LeadAddress | null;
  porte?: string | null;
  cnae?: string | null;
  situacao_cadastral?: string | null;
  email?: string | null;
  emails?: LeadEmail[] | null;
  telefone?: string | null;
  phones?: LeadPhone[] | null;
  socios?: LeadSocio[] | null;
  faturamento_estimado?: number | null;
  instagram?: string | null;
  linkedin?: string | null;
  website?: string | null;
  assigned_to?: string | null;
  created_by?: string | null;
  import_id?: string | null;
}

export interface LeadImportInsert {
  org_id: string;
  file_name: string;
  total_rows: number;
  lead_source?: string | null;
  created_by?: string | null;
}

export interface LeadImportErrorInsert {
  import_id: string;
  row_number: number;
  cnpj?: string | null;
  error_message: string;
}
