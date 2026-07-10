import { z } from 'zod';

import { isValidCnpj, stripCnpj } from '../utils/cnpj';

export const leadStatusValues = ['new', 'contacted', 'qualified', 'won', 'unqualified', 'archived'] as const;
export const enrichmentStatusValues = ['pending', 'enriching', 'enriched', 'enrichment_failed', 'not_found'] as const;
export const importStatusValues = ['processing', 'completed', 'failed'] as const;

export const cnpjSchema = z
  .string()
  .min(1, 'CNPJ é obrigatório')
  .transform(stripCnpj)
  .refine(isValidCnpj, { message: 'CNPJ inválido' });

export const cnpjOptionalSchema = z
  .string()
  .optional()
  .or(z.literal(''))
  .transform((val) => (val ? stripCnpj(val) : undefined))
  .refine((val) => !val || isValidCnpj(val), { message: 'CNPJ inválido' });

export const leadStatusSchema = z.enum(leadStatusValues);
export const enrichmentStatusSchema = z.enum(enrichmentStatusValues);
export const importStatusSchema = z.enum(importStatusValues);

export const leadAddressSchema = z.object({
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().max(2).optional(),
  cep: z.string().optional(),
});

// Sub-origem (canal) options now live as a single source of truth in
// STANDARD_FIELDS (features/settings-prospecting/constants/standard-fields.ts)
// and are resolved per-org via getCanalOptions (features/leads/utils/canal-options.ts).
// The previous CANAL_OPTIONS hardcoded list drifted out of sync with both
// the seed defaults and per-org standard_field_settings.options, so the
// CreateLeadDialog and LeadInfoPanel showed different lists to the same
// user. Removed 2026-05-16.

// Origem options — high-level lead source category (only 3 real origins)
export const LEAD_SOURCE_OPTIONS = [
  { value: 'Outbound', label: 'Outbound' },
  { value: 'Blackbox', label: 'Blackbox' },
  { value: 'Leadbroker', label: 'Leadbroker' },
] as const;

// Segmento options — business segment of the lead's company
export const SEGMENTO_OPTIONS = [
  'Agronegócio',
  'Aplicativo',
  'Automotivo',
  'Bens de Consumo',
  'Casa e Decoração',
  'Construção/Imobiliária',
  'Consultoria',
  'Cosmética',
  'E-commerce',
  'Educação',
  'Energia solar',
  'Estética',
  'Farmácia',
  'Finanças',
  'Food Service',
  'Franquia',
  'Indústria',
  'Logística',
  'Moda',
  'ONG',
  'PDV',
  'Prestação de serviços',
  'SaaS',
  'Saúde e Fitness',
  'Serviço',
  'Tecnologia e StartUp',
  'Telecom',
  'Turismo',
  'Varejo',
  'Outro',
] as const;

export const leadSourceValues = LEAD_SOURCE_OPTIONS.map((o) => o.value) as [string, ...string[]];
export const VALID_LEAD_SOURCES = new Set(leadSourceValues.map((v) => v.toLowerCase()));

/**
 * Normalize lead_source/canal: only Outbound/Blackbox/Leadbroker are valid lead_source.
 * Anything else (Apollo, Reativação, Indicação, etc.) belongs in canal as sub-origem.
 *
 * Returns the validated pair { lead_source, canal }.
 */
export function normalizeOriginFields(
  rawSource: string | null | undefined,
  rawCanal: string | null | undefined,
): { lead_source: string | null; canal: string | null } {
  const source = rawSource?.trim() || null;
  const canal = rawCanal?.trim() || null;

  if (!source) return { lead_source: null, canal };

  // Case-insensitive match against valid origens
  const lower = source.toLowerCase();
  if (VALID_LEAD_SOURCES.has(lower)) {
    // Normalize to canonical capitalization (Outbound, Blackbox, Leadbroker)
    const canonical = LEAD_SOURCE_OPTIONS.find((o) => o.value.toLowerCase() === lower);
    return { lead_source: canonical?.value ?? source, canal };
  }

  // Source value is actually a sub-origem — move it to canal, default to Outbound
  return {
    lead_source: 'Outbound',
    canal: canal ?? source,
  };
}

export const createLeadSchema = z.object({
  first_name: z.string().min(1, 'Primeiro nome é obrigatório'),
  last_name: z.string().min(1, 'Sobrenome é obrigatório'),
  email: z.string().email('Email inválido'),
  telefone: z.string().min(1, 'Telefone é obrigatório'),
  empresa: z.string().min(1, 'Empresa é obrigatória'),
  job_title: z.string().min(1, 'Cargo é obrigatório'),
  segmento: z.string().min(1, 'Segmento é obrigatório'),
  lead_source: z.string().min(1, 'Fonte é obrigatória'),
  canal: z.string().min(1, 'Sub-origem é obrigatório').optional().or(z.literal('')),
  is_inbound: z.boolean().default(false),
  assigned_to: z.string().uuid('Responsável inválido'),
  cadence_id: z.string().uuid('Cadência inválida').optional().or(z.literal('')),
  enrollment_mode: z.enum(['immediate', 'scheduled']).default('immediate'),
  scheduled_start: z.string().datetime({ offset: true }).optional(),
});

// Filtros que viram cláusula uuid no banco (`assigned_to`, `cadence_id`).
// Um param-lixo vindo da URL como `?assigned_to=undefined` chegava intacto ao
// `.eq()` e o Postgres estourava no cast pra uuid ("invalid input syntax for
// type uuid: undefined") → a tela inteira de Leads quebrava com "Erro ao buscar
// leads". Aqui saneamos: só passam adiante um uuid válido ou a sentinela do
// campo; qualquer outra coisa (undefined/null/vazio/lixo) vira "sem filtro".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidFilter = (sentinel: string) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v == null || v === sentinel || UUID_RE.test(v) ? v ?? undefined : undefined,
    );

export const leadFiltersSchema = z.object({
  status: leadStatusSchema.optional(),
  enrichment_status: enrichmentStatusSchema.optional(),
  porte: z.string().optional(),
  cnae: z.string().optional(),
  uf: z.string().max(2).optional(),
  lead_source: z.string().optional(),
  canal: z.string().optional(),
  search: z.string().optional(),
  assigned_to: uuidFilter('__unassigned__'),
  cadence_id: uuidFilter('__none__'),
  sort_by: z.enum(['created_at', 'fit_score', 'nome_fantasia', 'status', 'engagement_score']).default('created_at'),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(25),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type LeadFilters = z.infer<typeof leadFiltersSchema>;
