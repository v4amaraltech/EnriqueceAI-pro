import type {
  ConversionByOriginEntry,
  DailyDataPoint,
  LossReasonEntry,
  OpportunityKpiData,
  RankingCardData,
} from '@/features/dashboard/types';
import type { StepPerformanceMetrics } from '@/features/cadences/cadences.contract';
import type { LeadInfoPanelData } from '@/features/leads/components/lead-info-panel.utils';
import type { LeadCadenceInfo, LeadRow } from '@/features/leads/types';

// ---------------------------------------------------------------------------
// Dashboard — KPI de Oportunidades
// ---------------------------------------------------------------------------

function buildDailyData(): DailyDataPoint[] {
  const points: DailyDataPoint[] = [];
  for (let d = 1; d <= 30; d++) {
    const day = String(d).padStart(2, '0');
    points.push({
      date: `2026-03-${day}`,
      day: d,
      actual: Math.min(Math.round(1.8 * d + Math.sin(d) * 3), 47 + (d > 20 ? 0 : -47 + Math.round(1.8 * d))),
      target: Math.round((60 / 30) * d),
    });
  }
  // Garantir que o último ponto real bata com 47
  const last = points[points.length - 1];
  if (last) last.actual = 47;
  return points;
}

export const opportunityKpi: OpportunityKpiData = {
  totalOpportunities: 47,
  monthTarget: 60,
  conversionTarget: 12,
  percentOfTarget: -21.7,
  currentDay: 20,
  daysInMonth: 30,
  dailyData: buildDailyData(),
};

export const demoMonth = '2026-03';

// ---------------------------------------------------------------------------
// Dashboard — Rankings
// ---------------------------------------------------------------------------

export const leadsFinalizadosRanking: RankingCardData = {
  total: 72,
  monthTarget: 100,
  percentOfTarget: -28,
  averagePerSdr: 14.4,
  sdrBreakdown: [
    { userId: 'u1', userName: 'Ana Silva', value: 18, secondaryValue: 45 },
    { userId: 'u2', userName: 'Bruno Costa', value: 16, secondaryValue: 38 },
    { userId: 'u3', userName: 'Carla Mendes', value: 14, secondaryValue: 32 },
    { userId: 'u4', userName: 'Diego Ferreira', value: 13, secondaryValue: 28 },
    { userId: 'u5', userName: 'Elena Souza', value: 11, secondaryValue: 25 },
  ],
};

export const atividadesRanking: RankingCardData = {
  total: 485,
  monthTarget: 600,
  percentOfTarget: -19.2,
  averagePerSdr: 97,
  sdrBreakdown: [
    { userId: 'u1', userName: 'Ana Silva', value: 118 },
    { userId: 'u2', userName: 'Bruno Costa', value: 105 },
    { userId: 'u3', userName: 'Carla Mendes', value: 98 },
    { userId: 'u4', userName: 'Diego Ferreira', value: 87 },
    { userId: 'u5', userName: 'Elena Souza', value: 77 },
  ],
};

export const conversaoRanking: RankingCardData = {
  total: 18.5,
  monthTarget: 25,
  percentOfTarget: -26,
  averagePerSdr: 3.7,
  sdrBreakdown: [
    { userId: 'u1', userName: 'Ana Silva', value: 22.5 },
    { userId: 'u2', userName: 'Bruno Costa', value: 19.8 },
    { userId: 'u3', userName: 'Carla Mendes', value: 18.2 },
    { userId: 'u4', userName: 'Diego Ferreira', value: 16.5 },
    { userId: 'u5', userName: 'Elena Souza', value: 15.3 },
  ],
};

// ---------------------------------------------------------------------------
// Dashboard — Motivos de Perda
// ---------------------------------------------------------------------------

export const lossReasons: LossReasonEntry[] = [
  { reason: 'Sem orçamento', count: 35, percent: 35 },
  { reason: 'Timing ruim', count: 25, percent: 25 },
  { reason: 'Concorrente escolhido', count: 20, percent: 20 },
  { reason: 'Sem fit técnico', count: 12, percent: 12 },
  { reason: 'Sem resposta', count: 8, percent: 8 },
];

// ---------------------------------------------------------------------------
// Dashboard — Conversão por Origem
// ---------------------------------------------------------------------------

export const conversionByOrigin: ConversionByOriginEntry[] = [
  { origin: 'Outbound', converted: 45, lost: 120 },
  { origin: 'Inbound Marketing', converted: 32, lost: 28 },
  { origin: 'LinkedIn', converted: 18, lost: 22 },
  { origin: 'Indicação', converted: 12, lost: 5 },
];

// ---------------------------------------------------------------------------
// Cadência — Steps Performance
// ---------------------------------------------------------------------------

export const cadenceSteps: StepPerformanceMetrics[] = [
  {
    stepId: 's1',
    stepOrder: 1,
    channel: 'email',
    activityName: 'Email de apresentação',
    abEnabled: false,
    abWinnerVariant: null,
    sent: 1250,
    opened: 525,
    replied: 106,
    bounced: 26,
    pending: 0,
    openRate: 42,
    replyRate: 8.5,
    bounceRate: 2.1,
    completionRate: 100,
  },
  {
    stepId: 's2',
    stepOrder: 2,
    channel: 'email',
    activityName: 'Follow-up com case',
    abEnabled: false,
    abWinnerVariant: null,
    sent: 1080,
    opened: 410,
    replied: 75,
    bounced: 18,
    pending: 0,
    openRate: 38,
    replyRate: 6.9,
    bounceRate: 1.7,
    completionRate: 100,
  },
  {
    stepId: 's3',
    stepOrder: 3,
    channel: 'email',
    activityName: 'Proposta de valor',
    abEnabled: false,
    abWinnerVariant: null,
    sent: 920,
    opened: 322,
    replied: 55,
    bounced: 12,
    pending: 0,
    openRate: 35,
    replyRate: 6.0,
    bounceRate: 1.3,
    completionRate: 100,
  },
  {
    stepId: 's4',
    stepOrder: 4,
    channel: 'email',
    activityName: 'Social proof',
    abEnabled: false,
    abWinnerVariant: null,
    sent: 780,
    opened: 234,
    replied: 39,
    bounced: 8,
    pending: 0,
    openRate: 30,
    replyRate: 5.0,
    bounceRate: 1.0,
    completionRate: 100,
  },
  {
    stepId: 's5',
    stepOrder: 5,
    channel: 'email',
    activityName: 'Último follow-up',
    abEnabled: false,
    abWinnerVariant: null,
    sent: 650,
    opened: 163,
    replied: 26,
    bounced: 5,
    pending: 0,
    openRate: 25,
    replyRate: 4.0,
    bounceRate: 0.8,
    completionRate: 100,
  },
];

// ---------------------------------------------------------------------------
// Cadência — KPIs resumidos
// ---------------------------------------------------------------------------

export const cadenceKpis = {
  sent: 1250,
  openRate: 42,
  replyRate: 8.5,
  bounceRate: 2.1,
  meetings: 14,
};

// ---------------------------------------------------------------------------
// Lead Enriquecido
// ---------------------------------------------------------------------------

export const enrichedLead: LeadInfoPanelData = {
  id: 'demo-lead-1',
  cnpj: '12.345.678/0001-90',
  nome_fantasia: 'TechNova Soluções',
  razao_social: 'TechNova Soluções em TI Ltda',
  first_name: 'Rafael',
  last_name: 'Oliveira',
  job_title: 'CTO',
  lead_source: 'Outbound',
  canal: null,
  email: 'rafael@technova.com.br',
  emails: [
    { tipo: 'corporativo', email: 'rafael@technova.com.br' },
    { tipo: 'pessoal', email: 'rafael.oliveira@gmail.com' },
  ],
  telefone: '(11) 98765-4321',
  phones: [
    { tipo: 'celular', numero: '(11) 98765-4321' },
    { tipo: 'fixo', numero: '(11) 3456-7890' },
    { tipo: 'whatsapp', numero: '(11) 98765-4321' },
  ],
  porte: 'Média Empresa',
  cnae: '6311-9/00 - Consultoria em TI',
  situacao_cadastral: 'Ativa',
  faturamento_estimado: 12500000,
  endereco: {
    logradouro: 'Av. Paulista',
    numero: '1842',
    complemento: '14º andar',
    bairro: 'Bela Vista',
    cidade: 'São Paulo',
    uf: 'SP',
    cep: '01310-200',
  },
  socios: [
    {
      nome: 'Rafael Oliveira',
      qualificacao: 'Sócio-Administrador',
      cpf_masked: '***.456.789-**',
      participacao: 60,
      capital_social: 500000,
      emails: [
        { email: 'rafael@technova.com.br', ranking: 1 },
        { email: 'rafael.oliveira@gmail.com', ranking: 2 },
      ],
      celulares: [
        { ddd: 11, numero: '987654321', whatsapp: true, ranking: 1 },
      ],
    },
    {
      nome: 'Mariana Costa',
      qualificacao: 'Sócia',
      cpf_masked: '***.789.123-**',
      participacao: 40,
      capital_social: 350000,
      emails: [
        { email: 'mariana@technova.com.br', ranking: 1 },
      ],
      celulares: [
        { ddd: 11, numero: '912345678', whatsapp: true, ranking: 1 },
      ],
    },
  ],
  fit_score: 85,
  engagement_score: 72,
  status: 'qualified',
  enrichment_status: 'enriched',
  notes: 'Empresa interessada em automação de vendas. Reunião marcada para próxima semana.',
  instagram: '@technovasolucoes',
  linkedin: 'https://linkedin.com/company/technova',
  website: 'https://technova.com.br',
  custom_field_values: null,
  assigned_to: null,
  created_at: '2026-03-01T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Lista de Leads
// ---------------------------------------------------------------------------

const now = '2026-03-07T10:00:00Z';

export const demoLeads: LeadRow[] = [
  {
    id: 'l1', org_id: 'org1', cnpj: '12.345.678/0001-90', status: 'qualified', enrichment_status: 'enriched',
    razao_social: 'TechNova Soluções em TI Ltda', nome_fantasia: 'TechNova Soluções',
    first_name: 'Rafael', last_name: 'Oliveira', job_title: 'CTO', lead_source: 'Outbound', source_id: null, canal: null, is_inbound: false,
    endereco: { cidade: 'São Paulo', uf: 'SP' }, porte: 'Média Empresa',
    cnae: '6311-9/00', situacao_cadastral: 'Ativa', email: 'rafael@technova.com.br',
    telefone: '(11) 98765-4321', phones: null, emails: null, socios: null, faturamento_estimado: 12500000,
    notes: null, instagram: null, linkedin: null, website: 'https://technova.com.br',
    fit_score: 85, engagement_score: null, enriched_at: '2026-03-05T12:00:00Z', email_bounced_at: null, whatsapp_invalid_at: null,
    created_by: 'u1', assigned_to: 'u1', import_id: null, closer_id: null, won_by: null,
    contacted_at: '2026-03-02T09:00:00Z', qualified_at: '2026-03-05T12:00:00Z', meeting_scheduled_at: '2026-03-05T12:00:00Z', archived_at: null, won_at: null,
    deleted_at: null, created_at: '2026-03-01T09:00:00Z', updated_at: now,
    custom_field_values: null,
  },
  {
    id: 'l2', org_id: 'org1', cnpj: '98.765.432/0001-10', status: 'contacted', enrichment_status: 'enriched',
    razao_social: 'Nexus Digital Marketing Ltda', nome_fantasia: 'Nexus Digital',
    first_name: 'Fernanda', last_name: 'Lima', job_title: 'Head de Vendas', lead_source: 'Inbound Marketing', source_id: null, canal: null, is_inbound: true,
    endereco: { cidade: 'Rio de Janeiro', uf: 'RJ' }, porte: 'Pequena Empresa',
    cnae: '7311-4/00', situacao_cadastral: 'Ativa', email: 'fernanda@nexusdigital.com.br',
    telefone: '(21) 99876-5432', phones: null, emails: null, socios: null, faturamento_estimado: 3200000,
    notes: null, instagram: null, linkedin: null, website: null,
    fit_score: 72, engagement_score: null, enriched_at: '2026-03-04T10:00:00Z', email_bounced_at: null, whatsapp_invalid_at: null,
    created_by: 'u2', assigned_to: 'u2', import_id: null, closer_id: null, won_by: null,
    contacted_at: '2026-03-03T11:00:00Z', qualified_at: null, meeting_scheduled_at: null, archived_at: null, won_at: null,
    deleted_at: null, created_at: '2026-03-02T11:00:00Z', updated_at: now,
    custom_field_values: null,
  },
  {
    id: 'l3', org_id: 'org1', cnpj: '11.222.333/0001-44', status: 'new', enrichment_status: 'enriched',
    razao_social: 'Logística Express Transportes S.A.', nome_fantasia: 'Logística Express',
    first_name: 'Carlos', last_name: 'Santos', job_title: 'Diretor Comercial', lead_source: 'LinkedIn', source_id: null, canal: null, is_inbound: false,
    endereco: { cidade: 'Curitiba', uf: 'PR' }, porte: 'Grande Empresa',
    cnae: '4930-2/01', situacao_cadastral: 'Ativa', email: 'carlos@logisticaexpress.com.br',
    telefone: '(41) 99123-4567', phones: null, emails: null, socios: null, faturamento_estimado: 85000000,
    notes: null, instagram: null, linkedin: null, website: null,
    fit_score: 91, engagement_score: null, enriched_at: '2026-03-06T08:00:00Z', email_bounced_at: null, whatsapp_invalid_at: null,
    created_by: 'u1', assigned_to: 'u3', import_id: null, closer_id: null, won_by: null,
    contacted_at: null, qualified_at: null, meeting_scheduled_at: null, archived_at: null, won_at: null,
    deleted_at: null, created_at: '2026-03-03T14:00:00Z', updated_at: now,
    custom_field_values: null,
  },
  {
    id: 'l4', org_id: 'org1', cnpj: '44.555.666/0001-77', status: 'contacted', enrichment_status: 'enriched',
    razao_social: 'Grupo Inova Construções Ltda', nome_fantasia: 'Inova Construções',
    first_name: 'Patrícia', last_name: 'Almeida', job_title: 'Gerente de Compras', lead_source: 'Indicação', source_id: null, canal: null, is_inbound: false,
    endereco: { cidade: 'Belo Horizonte', uf: 'MG' }, porte: 'Média Empresa',
    cnae: '4120-4/00', situacao_cadastral: 'Ativa', email: 'patricia@inovaconstrucoes.com.br',
    telefone: '(31) 98456-7890', phones: null, emails: null, socios: null, faturamento_estimado: 28000000,
    notes: null, instagram: null, linkedin: null, website: null,
    fit_score: 68, engagement_score: null, enriched_at: '2026-03-04T15:00:00Z', email_bounced_at: null, whatsapp_invalid_at: null,
    created_by: 'u3', assigned_to: 'u1', import_id: null, closer_id: null, won_by: null,
    contacted_at: '2026-03-03T16:00:00Z', qualified_at: null, meeting_scheduled_at: null, archived_at: null, won_at: null,
    deleted_at: null, created_at: '2026-03-02T16:00:00Z', updated_at: now,
    custom_field_values: null,
  },
  {
    id: 'l5', org_id: 'org1', cnpj: '77.888.999/0001-11', status: 'qualified', enrichment_status: 'enriched',
    razao_social: 'CloudBase Tecnologia Ltda', nome_fantasia: 'CloudBase',
    first_name: 'Thiago', last_name: 'Ribeiro', job_title: 'VP de Tecnologia', lead_source: 'Outbound', source_id: null, canal: null, is_inbound: false,
    endereco: { cidade: 'Florianópolis', uf: 'SC' }, porte: 'Média Empresa',
    cnae: '6201-5/00', situacao_cadastral: 'Ativa', email: 'thiago@cloudbase.io',
    telefone: '(48) 99234-5678', phones: null, emails: null, socios: null, faturamento_estimado: 18000000,
    notes: null, instagram: null, linkedin: null, website: 'https://cloudbase.io',
    fit_score: 88, engagement_score: null, enriched_at: '2026-03-05T09:00:00Z', email_bounced_at: null, whatsapp_invalid_at: null,
    created_by: 'u2', assigned_to: 'u2', import_id: null, closer_id: null, won_by: null,
    contacted_at: null, qualified_at: null, meeting_scheduled_at: null, archived_at: null, won_at: null,
    deleted_at: null,
    created_at: '2026-03-01T10:00:00Z', updated_at: now,
    custom_field_values: null,
  },
  {
    id: 'l6', org_id: 'org1', cnpj: '22.333.444/0001-55', status: 'unqualified', enrichment_status: 'enriched',
    razao_social: 'Alimentos Sabor & Saúde Ltda', nome_fantasia: 'Sabor & Saúde',
    first_name: 'Juliana', last_name: 'Martins', job_title: 'Proprietária', lead_source: 'Inbound Marketing', source_id: null, canal: null, is_inbound: true,
    endereco: { cidade: 'Porto Alegre', uf: 'RS' }, porte: 'Micro Empresa',
    cnae: '1091-1/02', situacao_cadastral: 'Ativa', email: 'juliana@saboresaude.com.br',
    telefone: '(51) 98765-1234', phones: null, emails: null, socios: null, faturamento_estimado: 850000,
    notes: null, instagram: null, linkedin: null, website: null,
    fit_score: 32, engagement_score: null, enriched_at: '2026-03-03T11:00:00Z', email_bounced_at: null, whatsapp_invalid_at: null,
    created_by: 'u1', assigned_to: 'u1', import_id: null, closer_id: null, won_by: null,
    contacted_at: null, qualified_at: null, meeting_scheduled_at: null, archived_at: null, won_at: null,
    deleted_at: null,
    created_at: '2026-03-04T08:00:00Z', updated_at: now,
    custom_field_values: null,
  },
  {
    id: 'l7', org_id: 'org1', cnpj: '55.666.777/0001-33', status: 'new', enrichment_status: 'pending',
    razao_social: 'FinTech Solutions Brasil S.A.', nome_fantasia: 'FinTech Solutions',
    first_name: 'André', last_name: 'Nascimento', job_title: 'CEO', lead_source: 'LinkedIn', source_id: null, canal: null, is_inbound: false,
    endereco: { cidade: 'Campinas', uf: 'SP' }, porte: 'Média Empresa',
    cnae: '6499-9/99', situacao_cadastral: 'Ativa', email: 'andre@fintechsolutions.com.br',
    telefone: '(19) 99876-5432', phones: null, emails: null, socios: null, faturamento_estimado: 22000000,
    notes: null, instagram: null, linkedin: null, website: null,
    fit_score: null, engagement_score: null, enriched_at: null, email_bounced_at: null, whatsapp_invalid_at: null,
    created_by: 'u3', assigned_to: 'u3', import_id: null, closer_id: null, won_by: null,
    contacted_at: null, qualified_at: null, meeting_scheduled_at: null, archived_at: null, won_at: null,
    deleted_at: null,
    created_at: '2026-03-06T15:00:00Z', updated_at: now,
    custom_field_values: null,
  },
  {
    id: 'l8', org_id: 'org1', cnpj: '88.999.000/0001-66', status: 'contacted', enrichment_status: 'enriched',
    razao_social: 'Energia Verde Sustentável Ltda', nome_fantasia: 'Energia Verde',
    first_name: 'Camila', last_name: 'Rocha', job_title: 'Diretora de Operações', lead_source: 'Outbound', source_id: null, canal: null, is_inbound: false,
    endereco: { cidade: 'Salvador', uf: 'BA' }, porte: 'Média Empresa',
    cnae: '3511-5/01', situacao_cadastral: 'Ativa', email: 'camila@energiaverde.com.br',
    telefone: '(71) 98123-4567', phones: null, emails: null, socios: null, faturamento_estimado: 45000000,
    notes: null, instagram: null, linkedin: null, website: null,
    fit_score: 76, engagement_score: null, enriched_at: '2026-03-06T14:00:00Z', email_bounced_at: null, whatsapp_invalid_at: null,
    created_by: 'u2', assigned_to: 'u1', import_id: null, closer_id: null, won_by: null,
    contacted_at: null, qualified_at: null, meeting_scheduled_at: null, archived_at: null, won_at: null,
    deleted_at: null,
    created_at: '2026-03-05T09:30:00Z', updated_at: now,
    custom_field_values: null,
  },
];

export const demoCadenceInfo: Record<string, LeadCadenceInfo> = {
  l1: { cadence_name: 'Outbound Enterprise Q1', responsible_email: 'ana.silva@empresa.com.br', enrollment_status: 'active' },
  l2: { cadence_name: 'Inbound Nurture', responsible_email: 'bruno.costa@empresa.com.br', enrollment_status: 'active' },
  l3: { cadence_name: null, responsible_email: null, enrollment_status: null },
  l4: { cadence_name: 'Outbound Enterprise Q1', responsible_email: 'ana.silva@empresa.com.br', enrollment_status: 'paused' },
  l5: { cadence_name: 'Outbound Enterprise Q1', responsible_email: 'bruno.costa@empresa.com.br', enrollment_status: 'active' },
  l6: { cadence_name: 'Inbound Nurture', responsible_email: 'ana.silva@empresa.com.br', enrollment_status: 'active' },
  l7: { cadence_name: null, responsible_email: null, enrollment_status: null },
  l8: { cadence_name: 'Re-engajamento', responsible_email: 'bruno.costa@empresa.com.br', enrollment_status: 'paused' },
};

export const demoUserMap: Record<string, string> = {
  u1: 'Ana Silva',
  u2: 'Bruno Costa',
  u3: 'Carla Mendes',
};
