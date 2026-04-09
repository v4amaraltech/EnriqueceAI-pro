export interface TemplateVariable {
  key: string;
  label: string;
  placeholder: string;
  sampleValue: string;
  category: 'lead' | 'vendedor';
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  // Lead
  { key: 'primeiro_nome', label: 'Primeiro Nome', placeholder: '{{primeiro_nome}}', sampleValue: 'Rafael', category: 'lead' },
  { key: 'nome_completo', label: 'Nome Completo', placeholder: '{{nome_completo}}', sampleValue: 'Rafael Oliveira', category: 'lead' },
  { key: 'empresa', label: 'Empresa', placeholder: '{{empresa}}', sampleValue: 'Acme Tecnologia', category: 'lead' },
  { key: 'razao_social', label: 'Razão Social', placeholder: '{{razao_social}}', sampleValue: 'Acme Tecnologia Ltda', category: 'lead' },
  { key: 'cargo', label: 'Cargo', placeholder: '{{cargo}}', sampleValue: 'Diretor Comercial', category: 'lead' },
  { key: 'email', label: 'E-mail', placeholder: '{{email}}', sampleValue: 'rafael@acme.com.br', category: 'lead' },
  { key: 'telefone', label: 'Telefone', placeholder: '{{telefone}}', sampleValue: '(11) 99999-0000', category: 'lead' },
  { key: 'cnpj', label: 'CNPJ', placeholder: '{{cnpj}}', sampleValue: '12.345.678/0001-90', category: 'lead' },
  { key: 'instagram', label: 'Instagram', placeholder: '{{instagram}}', sampleValue: '@acmetech', category: 'lead' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: '{{linkedin}}', sampleValue: 'linkedin.com/in/rafael', category: 'lead' },
  { key: 'website', label: 'Website', placeholder: '{{website}}', sampleValue: 'acme.com.br', category: 'lead' },
  { key: 'origem', label: 'Origem', placeholder: '{{origem}}', sampleValue: 'Outbound', category: 'lead' },
  { key: 'sub_origem', label: 'Sub-origem', placeholder: '{{sub_origem}}', sampleValue: 'LinkedIn', category: 'lead' },
  { key: 'estado', label: 'Estado', placeholder: '{{estado}}', sampleValue: 'SP', category: 'lead' },
  { key: 'cidade', label: 'Cidade', placeholder: '{{cidade}}', sampleValue: 'São Paulo', category: 'lead' },
  { key: 'porte', label: 'Porte', placeholder: '{{porte}}', sampleValue: 'Média Empresa', category: 'lead' },
  { key: 'faturamento', label: 'Faturamento', placeholder: '{{faturamento}}', sampleValue: 'R$ 12.500.000', category: 'lead' },
  { key: 'cadencia', label: 'Cadência', placeholder: '{{cadencia}}', sampleValue: 'Outbound Q1', category: 'lead' },
  { key: 'etapa', label: 'Etapa', placeholder: '{{etapa}}', sampleValue: '3', category: 'lead' },
  // Vendedor
  { key: 'nome_vendedor', label: 'Nome do Vendedor', placeholder: '{{nome_vendedor}}', sampleValue: 'Ismael Dobelin', category: 'vendedor' },
];

export function renderTemplatePreview(text: string): string {
  return TEMPLATE_VARIABLES.reduce(
    (acc, v) => acc.replaceAll(v.placeholder, v.sampleValue),
    text,
  );
}
