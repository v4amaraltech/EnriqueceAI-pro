export interface StandardFieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  defaultOptions?: string[];
}

export const STANDARD_FIELDS: StandardFieldDef[] = [
  { key: 'first_name', label: 'Nome do Contato', type: 'text' },
  { key: 'last_name', label: 'Sobrenome', type: 'text' },
  { key: 'email', label: 'E-mail', type: 'text' },
  { key: 'telefone', label: 'Telefone', type: 'text' },
  { key: 'job_title', label: 'Cargo', type: 'text' },
  { key: 'cnpj', label: 'CNPJ', type: 'text' },
  { key: 'razao_social', label: 'Razão Social', type: 'text' },
  { key: 'nome_fantasia', label: 'Nome Fantasia', type: 'text' },
  { key: 'porte', label: 'Porte', type: 'text' },
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
  { key: 'instagram', label: 'Instagram', type: 'text' },
  { key: 'linkedin', label: 'LinkedIn', type: 'text' },
  { key: 'website', label: 'Website', type: 'text' },
];
