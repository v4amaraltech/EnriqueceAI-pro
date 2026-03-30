import { z } from 'zod';

import { cnpjOptionalSchema } from '@/features/leads/schemas/lead.schemas';

export const inboundLeadSchema = z.object({
  first_name: z.string().min(1, 'first_name é obrigatório'),
  last_name: z.string().optional(),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  telefone: z.string().optional(),
  empresa: z.string().optional(),
  cnpj: cnpjOptionalSchema,
  job_title: z.string().optional(),
  lead_source: z.string().optional(),
  canal: z.string().optional(),
  is_inbound: z.boolean().default(true),
  assigned_to: z.string().uuid('assigned_to deve ser UUID válido').optional(),
  notes: z.string().optional(),
  custom_fields: z.record(z.string()).optional(),
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
