import type { CrmProvider } from '../types/crm';

export const PROVIDER_NAMES: Record<CrmProvider, string> = {
  hubspot: 'HubSpot',
  pipedrive: 'Pipedrive',
  rdstation: 'RD Station',
  kommo: 'KommoCRM',
};

export const APP_LEAD_FIELDS = [
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'razao_social', label: 'Razao Social' },
  { value: 'nome_fantasia', label: 'Nome Fantasia' },
  { value: 'first_name', label: 'Nome do Contato' },
  { value: 'last_name', label: 'Sobrenome do Contato' },
  { value: 'job_title', label: 'Cargo' },
  { value: 'email', label: 'Email' },
  { value: 'telefone', label: 'Telefone' },
  { value: 'porte', label: 'Porte' },
  { value: 'cnae', label: 'CNAE' },
  { value: 'situacao_cadastral', label: 'Situacao Cadastral' },
  { value: 'faturamento_estimado', label: 'Faturamento Estimado' },
  { value: 'uf', label: 'UF' },
  { value: 'lead_source', label: 'Origem' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'website', label: 'Website' },
  { value: 'notes', label: 'Notas' },
] as const;

export const CRM_TARGET_FIELDS: Record<
  CrmProvider,
  Array<{ value: string; label: string }>
> = {
  hubspot: [
    { value: 'email', label: 'email' },
    { value: 'phone', label: 'phone' },
    { value: 'firstname', label: 'firstname' },
    { value: 'lastname', label: 'lastname' },
    { value: 'company', label: 'company' },
    { value: 'jobtitle', label: 'jobtitle' },
    { value: 'address', label: 'address' },
    { value: 'city', label: 'city' },
    { value: 'state', label: 'state' },
    { value: 'industry', label: 'industry' },
    { value: 'company_size', label: 'company_size' },
    { value: 'website', label: 'website' },
  ],
  pipedrive: [
    { value: 'name', label: 'name' },
    { value: 'email', label: 'email' },
    { value: 'phone', label: 'phone' },
    { value: 'org_name', label: 'org_name' },
    { value: 'job_title', label: 'job_title' },
  ],
  rdstation: [
    { value: 'email', label: 'email' },
    { value: 'phone', label: 'phone' },
    { value: 'mobile_phone', label: 'mobile_phone' },
    { value: 'name', label: 'name' },
    { value: 'title', label: 'title' },
  ],
  kommo: [
    { value: 'EMAIL', label: 'Email (EMAIL)' },
    { value: 'PHONE', label: 'Telefone (PHONE)' },
    { value: 'first_name', label: 'first_name' },
    { value: 'last_name', label: 'last_name' },
    { value: 'company_name', label: 'company_name' },
    { value: 'name', label: 'name (contato)' },
    { value: 'position', label: 'position (cargo)' },
  ],
};
