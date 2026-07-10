import { z } from 'zod';

/** Minimum call duration in seconds to trigger transcription + BANT analysis.
 *  Reduced from 180s → 90s on 2026-05-08: SDR qualification calls of 60-180s
 *  were being silently dropped, preventing BANT enrichment for those leads. */
export const TRANSCRIPTION_MIN_DURATION_SECONDS = 90;

export const callStatusValues = ['significant', 'not_significant', 'no_contact', 'busy', 'not_connected'] as const;
export const callTypeValues = ['inbound', 'outbound', 'manual'] as const;

/** Origem/discador da ligação. Ligações via WhatsApp gravam
 *  `metadata.provider = 'whatsapp'`; as demais (API4COM) não têm provider. */
export const callProviderValues = ['api4com', 'whatsapp'] as const;
export type CallProvider = (typeof callProviderValues)[number];

export const callStatusSchema = z.enum(callStatusValues);
export const callTypeSchema = z.enum(callTypeValues);

export const createCallSchema = z.object({
  origin: z.string().min(1, 'Origem é obrigatória'),
  destination: z.string().min(1, 'Destino é obrigatório'),
  started_at: z.string().optional(),
  duration_seconds: z.coerce.number().int().min(0).default(0),
  status: callStatusSchema.default('not_connected'),
  type: callTypeSchema.default('outbound'),
  notes: z.string().optional(),
  lead_id: z.string().uuid().optional(),
  recording_url: z.string().url().max(2048).optional(),
});

export const updateCallStatusSchema = z.object({
  id: z.string().uuid(),
  status: callStatusSchema,
});

export const callFiltersSchema = z.object({
  search: z.string().max(100).optional(),
  status: callStatusSchema.optional(),
  provider: z.enum(callProviderValues).optional(),
  user_id: z.string().uuid().optional(),
  period: z.enum(['today', 'week', 'month', 'all']).default('all'),
  favorites_only: z.coerce.boolean().default(false),
  important_only: z.coerce.boolean().default(false),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(20),
});

export const addFeedbackSchema = z.object({
  call_id: z.string().uuid(),
  content: z.string().min(1, 'Conteúdo é obrigatório'),
});

export type CreateCallInput = z.infer<typeof createCallSchema>;
export type UpdateCallStatusInput = z.infer<typeof updateCallStatusSchema>;
export type CallFilters = z.infer<typeof callFiltersSchema>;
export type AddFeedbackInput = z.infer<typeof addFeedbackSchema>;
