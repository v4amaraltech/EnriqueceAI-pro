import { z } from 'zod';

import { cnpjOptionalSchema } from '@/features/leads/schemas/lead.schemas';

export const inboundLeadSchema = z.object({
  first_name: z.string().min(1, 'first_name é obrigatório'),
  last_name: z.string().optional(),
  email: z.string().email('email inválido').min(1, 'email é obrigatório'),
  emails: z.array(z.object({
    tipo: z.enum(['corporativo', 'pessoal']),
    email: z.string().email('email inválido'),
  })).optional(),
  telefone: z.string().min(1, 'telefone é obrigatório'),
  empresa: z.string().min(1, 'empresa é obrigatório'),
  cnpj: cnpjOptionalSchema,
  job_title: z.string().optional(),
  lead_source: z.string().optional(),
  canal: z.string().optional(),
  instagram: z.string().optional(),
  porte: z.string().optional(),
  razao_social: z.string().optional(),
  faturamento_estimado: z.number().optional(),
  is_inbound: z.boolean().default(true),
  assigned_to: z.string().uuid('assigned_to deve ser UUID válido').optional(),
  cadence_id: z.string().uuid('cadence_id deve ser UUID válido').optional(),
  notes: z.string().optional(),
  custom_fields: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  linkedin: z.string().url('LinkedIn URL inválida').optional().or(z.literal('')),
  website: z.string().url('Website URL inválido').optional().or(z.literal('')),
});

export type InboundLeadInput = z.infer<typeof inboundLeadSchema>;

export const inboundLeadBatchSchema = z.object({
  leads: z.array(inboundLeadSchema).min(1).max(100),
  on_duplicate: z.enum(['skip', 'update']).default('skip'),
});

export const createApiKeySchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(100),
  expires_at: z.string().datetime({ offset: true }).optional().or(z.literal('')),
});
