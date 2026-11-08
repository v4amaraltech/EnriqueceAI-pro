import { z } from 'zod';

import { UUID_RE } from '@/lib/utils/uuid';

/**
 * Contrato versionado dos adaptadores de borda do n8n (PR13).
 *
 * Versao do contrato: `edge-command.v1`. Mudanca incompativel cria `v2` em rota
 * nova; a v1 nao muda de forma. Campos desconhecidos sao rejeitados (`strict`),
 * para que o n8n nunca passe destinatario, provedor ou numero por engano.
 */
export const EDGE_CONTRACT_VERSION = 'edge-command.v1';

export const EDGE_WORKFLOWS = ['ana_whatsapp', 'ana_email', 'ana_email_agent'] as const;
export type EdgeWorkflow = (typeof EDGE_WORKFLOWS)[number];

const uuid = z.string().regex(UUID_RE, 'uuid invalido');
const idempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9._:-]+$/, 'idempotency_key aceita apenas letras, numeros e . _ : -');

type RefShape = { workflow: EdgeWorkflow; execution_id?: string; lead_id?: string };

/** Cadencias identificam o passo por `execution_id`; o agente de e-mail, pelo lead. */
function refineTarget(v: RefShape, ctx: z.RefinementCtx) {
  if (v.workflow === 'ana_email_agent') {
    if (!v.lead_id) ctx.addIssue({ code: 'custom', path: ['lead_id'], message: 'lead_id obrigatorio no agente de e-mail' });
    if (v.execution_id) ctx.addIssue({ code: 'custom', path: ['execution_id'], message: 'execution_id nao se aplica ao agente de e-mail' });
  } else {
    if (!v.execution_id) ctx.addIssue({ code: 'custom', path: ['execution_id'], message: 'execution_id obrigatorio' });
    if (v.lead_id) ctx.addIssue({ code: 'custom', path: ['lead_id'], message: 'lead_id nao se aplica a passos de cadencia' });
  }
}

export const authorizeRequestSchema = z
  .object({
    workflow: z.enum(EDGE_WORKFLOWS),
    idempotency_key: idempotencyKey,
    execution_id: uuid.optional(),
    lead_id: uuid.optional(),
    /**
     * Template oficial candidato (somente WhatsApp): id da Meta ou nome. O app confere na Graph API
     * se esta APPROVED no idioma informado (padrao pt_BR); o n8n nao atesta aprovacao.
     */
    template: z
      .object({
        id: z.string().trim().min(1).max(100),
        language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'language invalido (ex.: pt_BR)').optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    refineTarget(v, ctx);
    if (v.template && v.workflow !== 'ana_whatsapp') {
      ctx.addIssue({ code: 'custom', path: ['template'], message: 'template so se aplica ao WhatsApp' });
    }
  });
export type AuthorizeRequest = z.infer<typeof authorizeRequestSchema>;

export const RESULT_STATUSES = ['enviado', 'falhou', 'incerto', 'nao_enviado'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const resultRequestSchema = z
  .object({
    workflow: z.enum(EDGE_WORKFLOWS),
    idempotency_key: idempotencyKey,
    execution_id: uuid.optional(),
    lead_id: uuid.optional(),
    status: z.enum(RESULT_STATUSES),
    texto: z.string().trim().min(1).max(1000).optional(),
    message_id: z.string().trim().min(1).max(200).optional(),
    erro: z.string().trim().min(1).max(300).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    refineTarget(v, ctx);
    // O e-mail da cadencia e enviado pelo proprio app (email-send); aqui so cabe registrar que nao saiu.
    if (v.workflow === 'ana_email' && v.status !== 'nao_enviado') {
      ctx.addIssue({ code: 'custom', path: ['status'], message: 'e-mail da cadencia: o resultado do envio vem de email-send' });
    }
    if (v.workflow === 'ana_whatsapp' && v.status === 'enviado' && !v.texto) {
      ctx.addIssue({ code: 'custom', path: ['texto'], message: 'texto obrigatorio quando enviado' });
    }
  });
export type ResultRequest = z.infer<typeof resultRequestSchema>;

export const emailSendRequestSchema = z
  .object({
    idempotency_key: idempotencyKey,
    execution_id: uuid,
    remetente_email: z.string().trim().toLowerCase().max(200).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'remetente_email invalido'),
    assunto: z.string().trim().min(1).max(150),
    corpo: z.string().trim().min(1).max(4000),
  })
  .strict();
export type EmailSendRequest = z.infer<typeof emailSendRequestSchema>;

export const replyRouteRequestSchema = z
  .object({
    idempotency_key: idempotencyKey,
    phone: z.string().trim().min(8).max(30),
    message_id: z.string().trim().min(1).max(200),
    texto: z.string().trim().min(1).max(1000),
    opt_out: z.boolean().optional(),
  })
  .strict();
export type ReplyRouteRequest = z.infer<typeof replyRouteRequestSchema>;
