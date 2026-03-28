export interface StandardFieldDef {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'currency' | 'date' | 'datetime' | 'select';
  defaultOptions?: string[];
  /** When true, options are loaded dynamically (e.g. org members) and cannot be edited here. */
  dynamicOptions?: boolean;
}

export const STANDARD_FIELDS: StandardFieldDef[] = [
  { key: 'first_name', label: 'Nome', type: 'text' },
  { key: 'last_name', label: 'Sobrenome', type: 'text' },
  { key: 'email', label: 'E-mail', type: 'text' },
  { key: 'telefone', label: 'Telefone', type: 'text' },
  { key: 'job_title', label: 'Cargo', type: 'text' },
  { key: 'cnpj', label: 'CNPJ', type: 'text' },
  { key: 'razao_social', label: 'Razão Social', type: 'text' },
  { key: 'nome_fantasia', label: 'Nome Fantasia', type: 'text' },
  {
    key: 'lead_source',
    label: 'Origem',
    type: 'select',
    defaultOptions: [
      'Outbound',
      'Inbound Marketing',
      'Indicação',
      'LinkedIn',
      'Evento',
      'Site',
      'Apollo.io',
      'Outro',
    ],
  },
  {
    key: 'canal',
    label: 'Canal',
    type: 'select',
    defaultOptions: [
      'Facebook',
      'Google',
      'Instagram',
      'Orgânico',
      'TikTok',
      'LinkedIn',
      'Indicação',
    ],
  },
  { key: 'assigned_to', label: 'SDR Responsável', type: 'select', dynamicOptions: true },
  { key: 'instagram', label: 'Instagram', type: 'text' },
  { key: 'linkedin', label: 'LinkedIn', type: 'text' },
  { key: 'website', label: 'Website', type: 'text' },
  { key: 'created_at', label: 'Data de Inscrição', type: 'date' },
];
