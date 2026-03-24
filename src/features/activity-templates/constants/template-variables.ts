export interface TemplateVariable {
  key: string;
  label: string;
  placeholder: string;
  sampleValue: string;
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { key: 'nome_lead', label: 'Nome do Lead', placeholder: '{{nome_lead}}', sampleValue: 'Acme Tecnologia' },
  { key: 'nome_fantasia', label: 'Nome Fantasia', placeholder: '{{nome_fantasia}}', sampleValue: 'Acme' },
  { key: 'email', label: 'E-mail', placeholder: '{{email}}', sampleValue: 'contato@acme.com.br' },
  { key: 'telefone', label: 'Telefone', placeholder: '{{telefone}}', sampleValue: '(11) 99999-0000' },
  { key: 'cargo', label: 'Cargo', placeholder: '{{cargo}}', sampleValue: 'Diretor Comercial' },
  { key: 'empresa', label: 'Empresa', placeholder: '{{empresa}}', sampleValue: 'Acme Tecnologia Ltda' },
  { key: 'cadencia', label: 'Cadência', placeholder: '{{cadencia}}', sampleValue: 'Outbound Q1' },
  { key: 'etapa', label: 'Etapa', placeholder: '{{etapa}}', sampleValue: '3' },
];

export function renderTemplatePreview(text: string): string {
  return TEMPLATE_VARIABLES.reduce(
    (acc, v) => acc.replaceAll(v.placeholder, v.sampleValue),
    text,
  );
}
