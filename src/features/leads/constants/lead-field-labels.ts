/**
 * Single source of truth for lead field labels in pt-BR.
 *
 * Used anywhere a raw lead column name would otherwise leak to the UI —
 * the activity timeline, the audit tab, update-lead change descriptions and
 * CRM sync events. Keep new lead columns mapped here so they never surface in
 * English (e.g. "last_name") to the user.
 */
export const LEAD_FIELD_LABELS: Record<string, string> = {
  first_name: 'Nome',
  last_name: 'Sobrenome',
  email: 'Email',
  emails: 'E-mails',
  telefone: 'Telefone',
  phones: 'Telefones',
  nome_fantasia: 'Nome Fantasia',
  razao_social: 'Razão Social',
  cnpj: 'CNPJ',
  status: 'Status',
  lead_source: 'Origem',
  canal: 'Sub-origem',
  segmento: 'Segmento',
  job_title: 'Cargo',
  linkedin: 'LinkedIn',
  website: 'Website',
  instagram: 'Instagram',
  notes: 'Anotações',
  assigned_to: 'Responsável',
  closer_id: 'Closer',
  is_inbound: 'Inbound',
  porte: 'Porte',
  cnae: 'CNAE',
  situacao_cadastral: 'Situação Cadastral',
  faturamento_estimado: 'Faturamento Estimado',
  uf: 'UF',
  custom_field_values: 'Campos Personalizados',
  socios: 'Sócios',
  email_bounced_at: 'Email Bounce',
  whatsapp_invalid_at: 'WhatsApp Inválido',
};

/** Translate a raw lead field key to its pt-BR label, falling back to the key. */
export function leadFieldLabel(field: string): string {
  return LEAD_FIELD_LABELS[field] ?? field;
}
