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

export const LEAD_SOURCE_OPTIONS = [
  { value: 'cold_outbound', label: 'Outbound' },
  { value: 'inbound_marketing', label: 'Inbound Marketing' },
  { value: 'indicacao', label: 'Indicação' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'evento', label: 'Evento' },
  { value: 'site', label: 'Site' },
  { value: 'outro', label: 'Outro' },
] as const;

export const leadSourceValues = LEAD_SOURCE_OPTIONS.map((o) => o.value) as [string, ...string[]];

export const createLeadSchema = z.object({
  first_name: z.string().min(1, 'Primeiro nome é obrigatório'),
  last_name: z.string().min(1, 'Sobrenome é obrigatório'),
  email: z.string().email('Email inválido'),
  telefone: z.string().min(1, 'Telefone é obrigatório'),
  empresa: z.string().min(1, 'Empresa é obrigatória'),
  job_title: z.string().min(1, 'Cargo é obrigatório'),
  lead_source: z.enum(leadSourceValues as [string, ...string[]], { required_error: 'Fonte é obrigatória' }),
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
  search: z.string().optional(),
  sort_by: z.enum(['created_at', 'fit_score']).default('created_at'),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(25),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type LeadFilters = z.infer<typeof leadFiltersSchema>;
