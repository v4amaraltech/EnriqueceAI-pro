import { z } from 'zod';

import { isValidCnpj, stripCnpj } from '../utils/cnpj';

export const leadStatusValues = ['new', 'contacted', 'qualified', 'unqualified', 'archived'] as const;
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

export const CANAL_OPTIONS = [
  'Facebook',
  'Google',
  'Instagram',
  'Orgânico',
  'TikTok',
  'LinkedIn',
  'Indicação',
  'Bing',
  'Prospecção Fria',
  'Outbound',
  'Landing Page Indicação',
  'Closer',
  'Lavras',
  'Planning',
  'Torres',
] as const;

export const LEAD_SOURCE_OPTIONS = [
  { value: 'outbound', label: 'Outbound' },
  { value: 'leadbroker', label: 'Leadbroker' },
  { value: 'blackbox', label: 'Blackbox' },
  { value: 'indicacao', label: 'Indicação' },
  { value: 'recomendacao', label: 'Recomendação' },
  { value: 'apollo', label: 'Apollo' },
  { value: 'reativacao', label: 'Reativação' },
  { value: 'recuperacao', label: 'Recuperação' },
  { value: 'api', label: 'API' },
  { value: 'webhook', label: 'Webhook' },
] as const;

export const leadSourceValues = LEAD_SOURCE_OPTIONS.map((o) => o.value) as [string, ...string[]];

export const createLeadSchema = z.object({
  first_name: z.string().min(1, 'Primeiro nome é obrigatório'),
  last_name: z.string().min(1, 'Sobrenome é obrigatório'),
  email: z.string().email('Email inválido'),
  telefone: z.string().min(1, 'Telefone é obrigatório'),
  empresa: z.string().min(1, 'Empresa é obrigatória'),
  job_title: z.string().min(1, 'Cargo é obrigatório'),
  lead_source: z.string().min(1, 'Fonte é obrigatória'),
  canal: z.string().min(1, 'Sub-origem é obrigatório').optional().or(z.literal('')),
  is_inbound: z.boolean().default(false),
  assigned_to: z.string().uuid('Responsável inválido'),
  cadence_id: z.string().uuid('Cadência inválida').optional().or(z.literal('')),
  enrollment_mode: z.enum(['immediate', 'scheduled']).default('immediate'),
  scheduled_start: z.string().datetime({ offset: true }).optional(),
});

export const leadFiltersSchema = z.object({
  status: leadStatusSchema.optional(),
  enrichment_status: enrichmentStatusSchema.optional(),
  porte: z.string().optional(),
  cnae: z.string().optional(),
  uf: z.string().max(2).optional(),
  lead_source: z.string().optional(),
  canal: z.string().optional(),
  search: z.string().optional(),
  assigned_to: z.string().optional(),
  cadence_id: z.string().optional(),
  sort_by: z.enum(['created_at', 'fit_score', 'nome_fantasia', 'status', 'engagement_score']).default('created_at'),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(25),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type LeadFilters = z.infer<typeof leadFiltersSchema>;
