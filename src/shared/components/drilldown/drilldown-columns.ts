import type { DrilldownColumn, DrilldownFilters, DrilldownMetric } from './drilldown.types';

interface DrilldownConfig {
  title: string;
  columns: DrilldownColumn[];
}

const leadColumns: DrilldownColumn[] = [
  { key: 'razaoSocial', label: 'Empresa' },
  { key: 'nomeFantasia', label: 'Nome Fantasia' },
  { key: 'email', label: 'Email' },
];

const interactionColumns: DrilldownColumn[] = [
  ...leadColumns,
  { key: 'type', label: 'Tipo' },
  { key: 'cadenceName', label: 'Cadência' },
  { key: 'createdAt', label: 'Data' },
];

const enrollmentColumns: DrilldownColumn[] = [
  ...leadColumns,
  { key: 'status', label: 'Status' },
  { key: 'enrolledAt', label: 'Inscrito em' },
];

const DRILLDOWN_CONFIG: Record<DrilldownMetric, DrilldownConfig> = {
  overall_leads: {
    title: 'Leads Trabalhados',
    columns: [
      ...leadColumns,
      { key: 'status', label: 'Status' },
    ],
  },
  overall_contacted: {
    title: 'Leads Contactados',
    columns: interactionColumns,
  },
  overall_replied: {
    title: 'Leads que Responderam',
    columns: interactionColumns,
  },
  overall_meetings: {
    title: 'Reuniões Agendadas',
    columns: interactionColumns,
  },
  overall_qualified: {
    title: 'Leads Qualificados',
    columns: [
      ...leadColumns,
      { key: 'status', label: 'Status' },
    ],
  },
  cadence_enrollments: {
    title: 'Inscritos na Cadência',
    columns: enrollmentColumns,
  },
  sdr_activities: {
    title: 'Atividades do SDR',
    columns: interactionColumns,
  },
  activity_total: {
    title: 'Total de Atividades',
    columns: interactionColumns,
  },
  activity_today: {
    title: 'Atividades de Hoje',
    columns: interactionColumns,
  },
  conversion_stage: {
    title: 'Leads por Estágio',
    columns: [
      ...leadColumns,
      { key: 'status', label: 'Status' },
    ],
  },
};

export function getDrilldownConfig(
  metric: DrilldownMetric,
  filters?: DrilldownFilters | null,
): DrilldownConfig {
  const config = DRILLDOWN_CONFIG[metric];

  if (metric === 'conversion_stage' && filters?.stage) {
    const stageLabels: Record<string, string> = {
      new: 'Novos',
      contacted: 'Contactados',
      qualified: 'Qualificados',
      unqualified: 'Desqualificados',
      archived: 'Arquivados',
    };
    return {
      ...config,
      title: `Leads — ${stageLabels[filters.stage] ?? filters.stage}`,
    };
  }

  return config;
}
