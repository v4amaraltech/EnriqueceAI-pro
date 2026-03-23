import { z } from 'zod';

import { channelTypeSchema } from '@/features/cadences/cadence.schemas';

export const createActivityTemplateSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(100, 'Nome muito longo'),
  channel: channelTypeSchema,
  instructions: z.string().max(5000, 'Instruções muito longas').default(''),
});

export const updateActivityTemplateSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(100, 'Nome muito longo').optional(),
  instructions: z.string().max(5000, 'Instruções muito longas').optional(),
});
