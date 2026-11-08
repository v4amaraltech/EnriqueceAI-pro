import { z } from 'zod';

import { UUID_RE } from '@/lib/utils/uuid';
import { inboundLeadSchema } from '@/features/inbound-api/schemas/inbound-lead.schemas';

/**
 * Contrato versionado da ingestao de borda do n8n (PR14): `edge-ingestion.v1`.
 * Mudanca incompativel cria `v2` em rota nova. Campos desconhecidos sao rejeitados.
 * O n8n nunca informa responsavel, cadencia, status ou consentimento: o app decide.
 */
export const EDGE_INGESTION_CONTRACT_VERSION = 'edge-ingestion.v1';

const uuid = z.string().regex(UUID_RE, 'uuid invalido');
const idempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9._:-]+$/, 'idempotency_key aceita apenas letras, numeros e . _ : -');

export const LEAD_INGEST_SOURCES = ['leadbroker'] as const;

/** Lead de borda: sem assigned_to, cadence_id nem consent_whatsapp (decisoes do app). */
export const edgeLeadSchema = inboundLeadSchema
  .omit({ assigned_to: true, cadence_id: true, consent_whatsapp: true, lead_source: true, is_inbound: true })
  .strict();

export const leadIngestRequestSchema = z
  .object({
    source: z.enum(LEAD_INGEST_SOURCES),
    idempotency_key: idempotencyKey,
    leads: z.array(edgeLeadSchema).min(1).max(100),
  })
  .strict();
export type LeadIngestRequest = z.infer<typeof leadIngestRequestSchema>;

export const CALL_PROVIDERS = ['api4com', 'callface'] as const;

export const callLookupRequestSchema = z
  .object({
    provider: z.enum(CALL_PROVIDERS),
    idempotency_key: idempotencyKey,
    external_call_id: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/),
  })
  .strict();
export type CallLookupRequest = z.infer<typeof callLookupRequestSchema>;

/** Campos que o enriquecimento pode preencher. Telefone, e-mail, responsavel e status ficam de fora. */
export const ENRICHMENT_FIELDS = [
  'razao_social',
  'nome_fantasia',
  'porte',
  'cnae',
  'segmento',
  'situacao_cadastral',
  'faturamento_estimado',
  'website',
  'linkedin',
  'instagram',
  'cnpj',
] as const;
export type EnrichmentField = (typeof ENRICHMENT_FIELDS)[number];

export const enrichmentRequestSchema = z
  .object({
    lead_id: uuid,
    idempotency_key: idempotencyKey,
    provider: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/),
    status: z.enum(['enriched', 'not_found', 'failed']),
    fields: z
      .object({
        razao_social: z.string().trim().min(1).max(200),
        nome_fantasia: z.string().trim().min(1).max(200),
        porte: z.string().trim().min(1).max(40),
        cnae: z.string().trim().min(1).max(40),
        segmento: z.string().trim().min(1).max(120),
        situacao_cadastral: z.string().trim().min(1).max(60),
        faturamento_estimado: z.number().finite().nonnegative(),
        website: z.string().url().max(300),
        linkedin: z.string().url().max(300),
        instagram: z.string().trim().min(1).max(120),
        cnpj: z.string().regex(/^\d{14}$/, 'cnpj deve ter 14 digitos'),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.status === 'enriched' && (!v.fields || Object.keys(v.fields).length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['fields'], message: 'fields obrigatorio quando status=enriched' });
    }
    if (v.status !== 'enriched' && v.fields) {
      ctx.addIssue({ code: 'custom', path: ['fields'], message: 'fields so se aplica a status=enriched' });
    }
  });
export type EnrichmentRequest = z.infer<typeof enrichmentRequestSchema>;
