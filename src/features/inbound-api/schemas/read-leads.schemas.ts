import { z } from 'zod';

/** lead_status enum values (validated against the DB enum). */
export const LEAD_STATUS_VALUES = [
  'new',
  'contacted',
  'qualified',
  'won',
  'unqualified',
  'archived',
] as const;

// Accept a comma-separated list of statuses (?status=new,contacted) and
// validate each against the enum.
const statusListSchema = z
  .string()
  .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
  .pipe(z.array(z.enum(LEAD_STATUS_VALUES)).min(1, 'status inválido'));

export const readLeadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(50),
  status: statusListSchema.optional(),
  updated_since: z.string().datetime({ offset: true, message: 'updated_since deve ser ISO 8601 com offset' }).optional(),
  lead_source: z.string().min(1).optional(),
  canal: z.string().min(1).optional(),
});

export type ReadLeadsQuery = z.infer<typeof readLeadsQuerySchema>;
