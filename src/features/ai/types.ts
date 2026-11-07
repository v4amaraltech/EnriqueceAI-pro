// AI feature types

export type ToneOption = 'professional' | 'consultative' | 'direct' | 'friendly';

export type ChannelTarget = 'email' | 'whatsapp';

export interface GenerateMessageRequest {
  channel: ChannelTarget;
  tone: ToneOption;
  leadContext: LeadContext;
  additionalContext?: string;
}

export interface LeadContext {
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  porte: string | null;
  cnae: string | null;
  situacao_cadastral: string | null;
  faturamento_estimado: number | null;
  endereco?: {
    cidade?: string;
    uf?: string;
  } | null;
  socios?: Array<{ nome: string; qualificacao?: string }> | null;
  /** Segmento do lead (`leads.segmento`) — guia o tom da mensagem. */
  segmento?: string | null;
}

export interface GenerateMessageResult {
  subject?: string;
  body: string;
  tokensUsed: number;
}

export interface AIUsageRow {
  id: string;
  org_id: string;
  usage_date: string;
  generation_count: number;
  daily_limit: number;
}

export interface AIUsageInfo {
  used: number;
  limit: number;
  remaining: number;
}
