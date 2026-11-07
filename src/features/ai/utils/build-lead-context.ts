import type { LeadContext } from '../types';

/**
 * Minimal lead shape accepted by the context builder.
 * Both EnrollmentWithLead.lead and ActivityLead satisfy this.
 */
interface LeadForContext {
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string;
  email: string | null;
  telefone: string | null;
  porte: string | null;
  municipio: string | null;
  uf: string | null;
  segmento?: string | null;
}

/**
 * Builds a LeadContext from any lead-shaped object.
 * Single source of truth — used by both cadence execution and activity preparation.
 */
export function buildLeadContext(lead: LeadForContext): LeadContext {
  return {
    nome_fantasia: lead.nome_fantasia,
    razao_social: lead.razao_social,
    cnpj: lead.cnpj,
    email: lead.email,
    telefone: lead.telefone,
    porte: lead.porte,
    cnae: null,
    situacao_cadastral: null,
    faturamento_estimado: null,
    endereco: lead.municipio
      ? { cidade: lead.municipio, uf: lead.uf ?? undefined }
      : null,
    ...(lead.segmento ? { segmento: lead.segmento } : {}),
  };
}
