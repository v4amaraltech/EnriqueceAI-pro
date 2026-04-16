import type { ActivityLead } from '@/features/activities/types';

import type { LeadRow, LeadAddress, LeadPhone, LeadSocio, LeadStatus, EnrichmentStatus } from '../types';

export interface LeadInfoPanelData {
  id: string;
  cnpj: string | null;
  nome_fantasia: string | null;
  razao_social: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  lead_source: string | null;
  canal: string | null;
  segmento?: string | null;
  email: string | null;
  telefone: string | null;
  phones: LeadPhone[] | null;
  porte: string | null;
  cnae: string | null;
  situacao_cadastral: string | null;
  faturamento_estimado: number | null;
  endereco: LeadAddress | null;
  socios: LeadSocio[] | null;
  fit_score: number | null;
  engagement_score: number | null;
  status: LeadStatus | null;
  enrichment_status: EnrichmentStatus | null;
  notes: string | null;
  instagram: string | null;
  linkedin: string | null;
  website: string | null;
  custom_field_values: Record<string, string> | null;
  assigned_to: string | null;
  created_at: string | null;
}

export function leadRowToInfoPanelData(lead: LeadRow): LeadInfoPanelData {
  return {
    id: lead.id,
    cnpj: lead.cnpj,
    nome_fantasia: lead.nome_fantasia,
    razao_social: lead.razao_social,
    first_name: lead.first_name,
    last_name: lead.last_name,
    job_title: lead.job_title,
    lead_source: lead.lead_source,
    canal: lead.canal,
    segmento: lead.segmento ?? null,
    email: lead.email,
    telefone: lead.telefone,
    phones: lead.phones,
    porte: lead.porte,
    cnae: lead.cnae,
    situacao_cadastral: lead.situacao_cadastral,
    faturamento_estimado: lead.faturamento_estimado,
    endereco: lead.endereco,
    socios: lead.socios,
    fit_score: lead.fit_score,
    engagement_score: lead.engagement_score,
    status: lead.status,
    enrichment_status: lead.enrichment_status,
    notes: lead.notes,
    instagram: lead.instagram,
    linkedin: lead.linkedin,
    website: lead.website,
    custom_field_values: lead.custom_field_values,
    assigned_to: lead.assigned_to,
    created_at: lead.created_at,
  };
}

export function activityLeadToInfoPanelData(lead: ActivityLead): LeadInfoPanelData {
  return {
    id: lead.id,
    cnpj: lead.cnpj,
    nome_fantasia: lead.nome_fantasia,
    razao_social: lead.razao_social,
    first_name: (lead as ActivityLead & { first_name?: string | null }).first_name ?? null,
    last_name: (lead as ActivityLead & { last_name?: string | null }).last_name ?? null,
    job_title: (lead as ActivityLead & { job_title?: string | null }).job_title ?? null,
    lead_source: (lead as ActivityLead & { lead_source?: string | null }).lead_source ?? null,
    canal: (lead as ActivityLead & { canal?: string | null }).canal ?? null,
    segmento: (lead as ActivityLead & { segmento?: string | null }).segmento ?? null,
    email: lead.email,
    telefone: lead.telefone,
    phones: (lead as ActivityLead & { phones?: LeadPhone[] | null }).phones ?? null,
    porte: lead.porte,
    cnae: null,
    situacao_cadastral: null,
    faturamento_estimado: null,
    endereco: lead.endereco ?? (lead.municipio || lead.uf ? { cidade: lead.municipio ?? undefined, uf: lead.uf ?? undefined } : null),
    socios: lead.socios,
    fit_score: lead.fit_score,
    engagement_score: lead.engagement_score,
    status: lead.status,
    enrichment_status: lead.enrichment_status,
    notes: lead.notes,
    instagram: lead.instagram,
    linkedin: lead.linkedin,
    website: lead.website,
    custom_field_values: (lead as ActivityLead & { custom_field_values?: Record<string, string> | null }).custom_field_values ?? null,
    assigned_to: (lead as ActivityLead & { assigned_to?: string | null }).assigned_to ?? null,
    created_at: (lead as ActivityLead & { created_at?: string | null }).created_at ?? null,
  };
}
