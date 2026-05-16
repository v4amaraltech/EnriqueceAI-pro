import { z } from 'zod';

// Enums
export const cadenceStatusSchema = z.enum(['draft', 'active', 'paused', 'archived']);
export const enrollmentStatusSchema = z.enum(['active', 'paused', 'completed', 'replied', 'bounced', 'unsubscribed']);
export const channelTypeSchema = z.enum(['email', 'whatsapp', 'phone', 'linkedin', 'research']);
export const interactionTypeSchema = z.enum([
  'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'meeting_scheduled',
]);

// Reply type schema for auto email steps
export const replyTypeSchema = z.enum(['new_conversation', 'reply']);

// Cadence type schema
export const cadenceTypeSchema = z.enum(['standard', 'auto_email']);

// Cadence priority schema
export const cadencePrioritySchema = z.enum(['high', 'medium', 'low']);

// Cadence origin schema
export const cadenceOriginSchema = z.enum(['inbound_active', 'inbound_passive', 'outbound']);

// Auto-loss is a paired feature: setting one half without the other leaves
// the cron with no reason to stamp on the enrollment, so the cadence
// silently does nothing. Reject the partial state at the schema layer.
const autoLossPairCheck = (
  data: { auto_loss_after_days?: number | null; auto_loss_reason_id?: string | null },
  ctx: z.RefinementCtx,
) => {
  const hasDays = data.auto_loss_after_days != null;
  const hasReason = data.auto_loss_reason_id != null && data.auto_loss_reason_id !== '';
  if (hasDays !== hasReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'Para usar perda automática por inatividade, defina os dois campos juntos: dias de inatividade e motivo de perda.',
      path: hasDays ? ['auto_loss_reason_id'] : ['auto_loss_after_days'],
    });
  }
};

// Cadence creation schema
export const createCadenceSchema = z
  .object({
    name: z.string().min(1, 'Nome é obrigatório').max(200),
    description: z.string().max(1000).nullable().optional(),
    type: cadenceTypeSchema.default('standard'),
    priority: cadencePrioritySchema.default('medium'),
    origin: cadenceOriginSchema.default('outbound'),
    auto_loss_after_days: z.number().int().positive().nullable().optional(),
    auto_loss_reason_id: z.string().uuid().nullable().optional(),
  })
  .superRefine(autoLossPairCheck);

// Cadence update schema
export const updateCadenceSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
    status: cadenceStatusSchema.optional(),
    priority: cadencePrioritySchema.optional(),
    origin: cadenceOriginSchema.optional(),
    auto_loss_after_days: z.number().int().positive().nullable().optional(),
    auto_loss_reason_id: z.string().uuid().nullable().optional(),
  })
  .superRefine(autoLossPairCheck);

// Cadence step creation schema
export const createCadenceStepSchema = z.object({
  step_order: z.number().int().positive('Ordem do passo deve ser positiva'),
  channel: channelTypeSchema,
  template_id: z.string().uuid().nullable().optional(),
  delay_days: z.number().int().min(0, 'Dias de delay não podem ser negativos').default(0),
  delay_hours: z.number().int().min(0, 'Horas de delay não podem ser negativas').default(0),
  ai_personalization: z.boolean().default(false),
  activity_name: z.string().max(200).nullable().optional(),
  instructions: z.string().max(5000).nullable().optional(),
});

// Cadence step update schema
export const updateCadenceStepSchema = z.object({
  step_order: z.number().int().positive().optional(),
  channel: channelTypeSchema.optional(),
  template_id: z.string().uuid().nullable().optional(),
  delay_days: z.number().int().min(0).optional(),
  delay_hours: z.number().int().min(0).optional(),
  ai_personalization: z.boolean().optional(),
  activity_name: z.string().max(200).nullable().optional(),
  instructions: z.string().max(5000).nullable().optional(),
});

// Enrollment creation schema
export const createEnrollmentSchema = z.object({
  cadence_id: z.string().uuid('ID da cadência inválido'),
  lead_id: z.string().uuid('ID do lead inválido'),
});

// Batch enrollment schema
export const batchEnrollmentSchema = z.object({
  cadence_id: z.string().uuid('ID da cadência inválido'),
  lead_ids: z.array(z.string().uuid()).min(1, 'Selecione pelo menos um lead').max(500, 'Máximo de 500 leads por vez'),
});

// Template variable extraction regex
export const TEMPLATE_VARIABLE_REGEX = /\{\{(\w+)\}\}/g;

// Available template variables — lead data
export const AVAILABLE_TEMPLATE_VARIABLES = [
  'primeiro_nome',
  'nome_completo',
  'empresa',
  'nome_fantasia',
  'cargo',
  'email',
  'telefone',
  'instagram',
  'linkedin',
  'website',
  'origem',
  'sub_origem',
  'estado',
  'cidade',
  'faturamento',
  'etapa',
] as const;

// Vendor/sender variables
export const VENDOR_TEMPLATE_VARIABLES = [
  'nome_vendedor',
  'email_vendedor',
] as const;

// All variables combined
export const ALL_TEMPLATE_VARIABLES = [
  ...AVAILABLE_TEMPLATE_VARIABLES,
  ...VENDOR_TEMPLATE_VARIABLES,
] as const;

export type TemplateVariable = (typeof AVAILABLE_TEMPLATE_VARIABLES)[number];
export type VendorVariable = (typeof VENDOR_TEMPLATE_VARIABLES)[number];
export type AllTemplateVariable = (typeof ALL_TEMPLATE_VARIABLES)[number];

// Message template creation schema
export const createTemplateSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(200),
  channel: channelTypeSchema,
  subject: z.string().max(500).nullable().optional(),
  body: z.string().min(1, 'Corpo da mensagem é obrigatório').max(10000),
}).refine(
  (data) => {
    if (data.channel === 'email' && (!data.subject || data.subject.trim() === '')) {
      return false;
    }
    return true;
  },
  { message: 'Assunto é obrigatório para templates de email', path: ['subject'] },
).refine(
  (data) => {
    if (data.channel === 'whatsapp' && data.body.length > 4096) {
      return false;
    }
    return true;
  },
  { message: 'Mensagens WhatsApp devem ter no máximo 4096 caracteres', path: ['body'] },
);

// Message template update schema
export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  channel: channelTypeSchema.optional(),
  subject: z.string().max(500).nullable().optional(),
  body: z.string().min(1).max(10000).optional(),
});

// Cadence list filters schema
export const cadenceFiltersSchema = z.object({
  status: cadenceStatusSchema.optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

// Template list filters schema
export const templateFiltersSchema = z.object({
  channel: channelTypeSchema.optional(),
  search: z.string().optional(),
  is_system: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

// Auto email step schema
export const autoEmailStepSchema = z.object({
  subject: z.string().max(500).default(''),
  body: z.string().min(1, 'Corpo do email é obrigatório').max(10000),
  delay_days: z.number().int().min(0).default(0),
  delay_hours: z.number().int().min(0).default(0),
  ai_personalization: z.boolean().default(false),
  reply_type: replyTypeSchema.default('new_conversation'),
  ab_enabled: z.boolean().default(false),
  ab_distribution: z.number().int().min(1).max(99).default(50),
  subject_b: z.string().max(500).default(''),
  body_b: z.string().max(10000).default(''),
}).refine(
  (data) => {
    if (data.reply_type !== 'reply' && (!data.subject || data.subject.trim() === '')) {
      return false;
    }
    return true;
  },
  { message: 'Assunto é obrigatório para nova conversa', path: ['subject'] },
).refine(
  (data) => {
    if (data.ab_enabled && (!data.body_b || data.body_b.trim() === '')) {
      return false;
    }
    return true;
  },
  { message: 'Corpo da Variante B é obrigatório quando Teste A/B está ativo', path: ['body_b'] },
).refine(
  (data) => {
    if (data.ab_enabled && data.reply_type !== 'reply' && (!data.subject_b || data.subject_b.trim() === '')) {
      return false;
    }
    return true;
  },
  { message: 'Assunto da Variante B é obrigatório', path: ['subject_b'] },
);

// Save auto email cadence schema
export const saveAutoEmailCadenceSchema = z.object({
  cadence_id: z.string().uuid('ID da cadência inválido'),
  steps: z.array(autoEmailStepSchema).min(1, 'Adicione pelo menos 1 step'),
});

// Inferred types
export type CreateCadence = z.infer<typeof createCadenceSchema>;
export type UpdateCadence = z.infer<typeof updateCadenceSchema>;
export type CreateCadenceStep = z.infer<typeof createCadenceStepSchema>;
export type UpdateCadenceStep = z.infer<typeof updateCadenceStepSchema>;
export type CreateEnrollment = z.infer<typeof createEnrollmentSchema>;
export type BatchEnrollment = z.infer<typeof batchEnrollmentSchema>;
export type CreateTemplate = z.input<typeof createTemplateSchema>;
export type UpdateTemplate = z.infer<typeof updateTemplateSchema>;
export type CadenceFilters = z.infer<typeof cadenceFiltersSchema>;
export type TemplateFilters = z.infer<typeof templateFiltersSchema>;
export type AutoEmailStep = z.infer<typeof autoEmailStepSchema>;
export type SaveAutoEmailCadence = z.infer<typeof saveAutoEmailCadenceSchema>;
