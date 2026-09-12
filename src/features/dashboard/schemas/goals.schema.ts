import { z } from 'zod';

const userGoalSchema = z.object({
  userId: z.string().uuid(),
  // opcionais com default: clientes antigos (deployment skew) não enviam esses
  // campos; o upsert grava 0 nesse caso, sem quebrar a validação.
  leadsOpenedTarget: z.number().int().min(0).optional().default(0),
  meetingsScheduledTarget: z.number().int().min(0).optional().default(0),
  meetingsHeldTarget: z.number().int().min(0).optional().default(0),
  callsTarget: z.number().int().min(0).optional().default(0),
  callsConnectedTarget: z.number().int().min(0).optional().default(0),
  saoTarget: z.number().int().min(0).optional().default(0),
  // legado (deployment skew): clientes antigos ainda enviam "oportunidades".
  // Aceito e ignorado — a coluna opportunity_target virou vestigial.
  opportunityTarget: z.number().int().min(0).optional(),
});

export const saveGoalsSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Mês deve ser YYYY-MM'),
  leadsFinishedTarget: z.number().int().min(0, 'Meta deve ser >= 0'),
  activitiesTarget: z.number().int().min(0, 'Meta deve ser >= 0'),
  conversionTarget: z
    .number()
    .min(0, 'Taxa deve ser >= 0')
    .max(100, 'Taxa deve ser <= 100'),
  leadsOpenedTarget: z.number().int().min(0, 'Meta deve ser >= 0'),
  meetingsScheduledTarget: z.number().int().min(0, 'Meta deve ser >= 0'),
  meetingsHeldTarget: z.number().int().min(0, 'Meta deve ser >= 0'),
  // opcional com default (deployment skew): clientes antigos não enviam SAO.
  saoTarget: z.number().int().min(0, 'Meta deve ser >= 0').optional().default(0),
  userGoals: z.array(userGoalSchema).min(1, 'Pelo menos 1 vendedor'),
});

// z.input (não z.infer): a action recebe o payload cru, onde os campos com
// `.default(0)` (metas individuais de reuniões) são opcionais — clientes antigos
// (deployment skew) podem omiti-los.
export type SaveGoalsInput = z.input<typeof saveGoalsSchema>;
