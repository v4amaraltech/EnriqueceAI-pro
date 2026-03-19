import { z } from 'zod';

export const drilldownMetricSchema = z.enum([
  'overall_leads',
  'overall_contacted',
  'overall_replied',
  'overall_meetings',
  'overall_qualified',
  'cadence_enrollments',
  'sdr_activities',
  'activity_total',
  'activity_today',
  'conversion_stage',
]);

export const drilldownFiltersSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  sdrId: z.string().optional(),
  cadenceId: z.string().optional(),
  stage: z.string().optional(),
});

export const fetchDrilldownInputSchema = z.object({
  metric: drilldownMetricSchema,
  filters: drilldownFiltersSchema,
  page: z.number().int().min(1).default(1),
});

export type FetchDrilldownInput = z.infer<typeof fetchDrilldownInputSchema>;
