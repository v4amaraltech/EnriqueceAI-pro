import { z } from 'zod';

const userGoalSchema = z.object({
  userId: z.string().uuid(),
  opportunityTarget: z.number().int().min(0),
});

export const saveGoalsSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Mês deve ser YYYY-MM'),
  opportunityTarget: z.number().int().min(0, 'Meta deve ser >= 0'),
  leadsFinishedTarget: z.number().int().min(0, 'Meta deve ser >= 0'),
  activitiesTarget: z.number().int().min(0, 'Meta deve ser >= 0'),
  conversionTarget: z
    .number()
    .min(0, 'Taxa deve ser >= 0')
    .max(100, 'Taxa deve ser <= 100'),
  leadsOpenedTarget: z.number().int().min(0, 'Meta deve ser >= 0'),
  meetingsHeldTarget: z.number().int().min(0, 'Meta deve ser >= 0'),
  userGoals: z.array(userGoalSchema).min(1, 'Pelo menos 1 vendedor'),
});

export type SaveGoalsInput = z.infer<typeof saveGoalsSchema>;
