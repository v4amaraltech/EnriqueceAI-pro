import { z } from 'zod';

const userGoalSchema = z.object({
  userId: z.string().uuid(),
  opportunityTarget: z.number().int().min(0),
  // opcionais com default: clientes antigos (deployment skew) não enviam esses
  // campos; o upsert grava 0 nesse caso, sem quebrar a validação.
  meetingsScheduledTarget: z.number().int().min(0).optional().default(0),
  meetingsHeldTarget: z.number().int().min(0).optional().default(0),
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
  userGoals: z.array(userGoalSchema).min(1, 'Pelo menos 1 vendedor'),
});

// z.input (não z.infer): a action recebe o payload cru, onde os campos com
// `.default(0)` (metas individuais de reuniões) são opcionais — clientes antigos
// (deployment skew) podem omiti-los.
export type SaveGoalsInput = z.input<typeof saveGoalsSchema>;
