import { createHash } from 'node:crypto';

import type { InboundBatchResult } from '@/features/inbound-api/types';

import type { Uuid } from '../types';
import { isScopedFlagEnabled } from '../services/flag-scope.service';

import type { EdgeAuth, EdgeResponse } from './edge-command.service';
import {
  EDGE_INGESTION_CONTRACT_VERSION,
  ENRICHMENT_FIELDS,
  type CallLookupRequest,
  type EnrichmentField,
  type EnrichmentRequest,
  type LeadIngestRequest,
} from './edge-ingestion.schemas';

/**
 * Ingestao de borda do n8n (PR14): LeadBroker, API4Com e enriquecimento.
 *
 * Flag `edge_ingestion_v1` (app_flags, escopo por organizacao via flag-scope, nasce desligada).
 * Desligada: 403 `adapter_disabled`, nenhuma leitura nem escrita. Rotas `/api/v1/leads`,
 * `/api/webhooks/api4com` e fluxos atuais seguem sem alteracao.
 *
 * Regras:
 *  - O app decide: responsavel, cadencia, status e consentimento nunca vem do n8n.
 *  - Enriquecimento so PREENCHE campos vazios; nunca sobrescreve nem troca telefone/e-mail.
 *  - Ligacoes: o endpoint so informa se a ligacao ja existe (evita duplicar); nao cria nada.
 *  - Logs e trilha com ids, codigos e nomes de campo apenas, sem PII.
 */
export const EDGE_INGESTION_FLAG_KEY = 'edge_ingestion_v1';
export const EDGE_INGESTION_MODEL_VERSION = 'edge_ingestion_v1';

export type StoredIngestionEvent = { disposition: string; reasons: string[] };

export interface EnrichTargetLead {
  id: Uuid;
  enrichment_status: string | null;
  values: Partial<Record<EnrichmentField, unknown>>;
}

export interface EdgeIngestionPorts {
  isEnabled(orgId: Uuid): Promise<boolean>;
  /** Idempotencia de lote de leads (sem lead_id ainda). */
  isBatchProcessed(orgId: Uuid, key: string): Promise<boolean | 'error'>;
  markBatchProcessed(orgId: Uuid, key: string): Promise<void>;
  ingestLeads(orgId: Uuid, leads: LeadIngestRequest['leads'], source: string): Promise<InboundBatchResult>;
  findCall(
    orgId: Uuid,
    provider: string,
    externalId: string,
  ): Promise<{ callId: Uuid; leadId: Uuid | null; status: string | null } | null | 'error'>;
  loadLead(orgId: Uuid, leadId: Uuid): Promise<EnrichTargetLead | null | 'error'>;
  cnpjTaken(orgId: Uuid, cnpj: string, exceptLeadId: Uuid): Promise<boolean | 'error'>;
  applyEnrichment(input: {
    orgId: Uuid;
    leadId: Uuid;
    patch: Partial<Record<EnrichmentField, unknown>>;
    status: 'enriched' | 'not_found' | 'enrichment_failed' | null;
    provider: string;
  }): Promise<boolean>;
  readEvent(orgId: Uuid, key: string): Promise<StoredIngestionEvent | null | 'error'>;
  recordEvent(input: {
    orgId: Uuid;
    leadId: Uuid;
    key: string;
    disposition: string;
    reasons: string[];
  }): Promise<'recorded' | 'duplicate' | 'error'>;
}

type Op = 'leads' | 'calls' | 'enrichment';

export function ingestionKey(orgId: Uuid, op: Op, clientKey: string): string {
  const digest = createHash('sha256').update(`${orgId}|${op}|${clientKey}`).digest('hex');
  return `edge.ingest.v1.${op}.${digest}`;
}

export function isEdgeIngestionEnabled(orgId: Uuid): Promise<boolean> {
  return isScopedFlagEnabled(EDGE_INGESTION_FLAG_KEY, { orgId });
}

const respond = (status: number, body: Record<string, unknown>): EdgeResponse => ({
  status,
  body: { contract_version: EDGE_INGESTION_CONTRACT_VERSION, ...body },
});
const failure = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  respond(status, { success: false, code, error, ...extra });
const disabled = () => failure(403, 'adapter_disabled', 'Ingestão de borda desligada para esta organização.');
const unavailable = () => failure(503, 'unavailable', 'Falha de leitura ou gravação; tente novamente.', { retryable: true });

// ---------------------------------------------------------------------------
// 1. Leads (LeadBroker)
// ---------------------------------------------------------------------------

export async function ingestLeadsEdge(ports: EdgeIngestionPorts, auth: EdgeAuth, req: LeadIngestRequest): Promise<EdgeResponse> {
  if (!(await ports.isEnabled(auth.orgId))) return disabled();

  const key = ingestionKey(auth.orgId, 'leads', req.idempotency_key);
  const done = await ports.isBatchProcessed(auth.orgId, key);
  if (done === 'error') return unavailable();
  if (done) {
    return respond(200, { success: true, data: { idempotency_key: req.idempotency_key, replay: true, next_action: 'none' } });
  }

  let result: InboundBatchResult;
  try {
    result = await ports.ingestLeads(auth.orgId, req.leads, req.source);
  } catch (e) {
    console.error('[edge-ingestion/leads]', e instanceof Error ? e.message : 'erro');
    return unavailable();
  }

  // Lote so e marcado se nao houve erro: erro por item pode ser reenviado (duplicados sao ignorados).
  if (result.errors === 0) await ports.markBatchProcessed(auth.orgId, key);

  return respond(200, {
    success: true,
    data: {
      idempotency_key: req.idempotency_key,
      replay: false,
      received: result.received,
      created: result.created,
      duplicates: result.duplicates,
      errors: result.errors,
      // `updated` nunca ocorre: o app fixa on_duplicate=skip.
      results: result.results.map((r) => ({
        index: r.index,
        status: r.status,
        lead_id: r.lead_id ?? r.existing_lead_id ?? null,
        ...(r.status === 'error' ? { error: r.error ?? 'erro' } : {}),
      })),
      next_action: result.errors > 0 ? 'retry_failed' : 'none',
    },
  });
}

// ---------------------------------------------------------------------------
// 2. Ligacoes (API4Com / Callface): consulta de duplicidade
// ---------------------------------------------------------------------------

export async function lookupCallEdge(ports: EdgeIngestionPorts, auth: EdgeAuth, req: CallLookupRequest): Promise<EdgeResponse> {
  if (!(await ports.isEnabled(auth.orgId))) return disabled();
  const found = await ports.findCall(auth.orgId, req.provider, req.external_call_id);
  if (found === 'error') return unavailable();
  if (found) {
    return respond(200, {
      success: true,
      data: { idempotency_key: req.idempotency_key, known: true, call_id: found.callId, lead_id: found.leadId, status: found.status, next_action: 'skip' },
    });
  }
  // Desconhecida: o n8n segue entregando ao webhook do app, como hoje. O app nao cria a ligacao aqui.
  return respond(200, {
    success: true,
    data: { idempotency_key: req.idempotency_key, known: false, call_id: null, lead_id: null, status: null, next_action: 'forward' },
  });
}

// ---------------------------------------------------------------------------
// 3. Enriquecimento
// ---------------------------------------------------------------------------

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** Puro: so campos hoje vazios entram no patch. `cnpj` exige nao estar em uso por outro lead. */
export function computeEnrichmentPatch(
  current: EnrichTargetLead['values'],
  fields: NonNullable<EnrichmentRequest['fields']>,
  cnpjTaken: boolean,
): { patch: Partial<Record<EnrichmentField, unknown>>; skipped: string[] } {
  const patch: Partial<Record<EnrichmentField, unknown>> = {};
  const skipped: string[] = [];
  for (const f of ENRICHMENT_FIELDS) {
    const next = fields[f];
    if (next === undefined) continue;
    if (!isEmpty(current[f])) {
      skipped.push(`${f}_already_set`);
      continue;
    }
    if (f === 'cnpj' && cnpjTaken) {
      skipped.push('cnpj_in_use');
      continue;
    }
    patch[f] = next;
  }
  return { patch, skipped };
}

export async function applyEnrichmentEdge(ports: EdgeIngestionPorts, auth: EdgeAuth, req: EnrichmentRequest): Promise<EdgeResponse> {
  if (!(await ports.isEnabled(auth.orgId))) return disabled();

  const key = ingestionKey(auth.orgId, 'enrichment', req.idempotency_key);
  const stored = await ports.readEvent(auth.orgId, key);
  if (stored === 'error') return unavailable();
  if (stored) {
    return respond(200, {
      success: true,
      data: { idempotency_key: req.idempotency_key, replay: true, lead_id: req.lead_id, applied: [], skipped: stored.reasons, next_action: 'none' },
    });
  }

  // Lead de outra organizacao e indistinguivel de inexistente.
  const lead = await ports.loadLead(auth.orgId, req.lead_id);
  if (lead === 'error') return unavailable();
  if (!lead) return failure(404, 'not_found', 'Lead não encontrado.');

  let patch: Partial<Record<EnrichmentField, unknown>> = {};
  let skipped: string[] = [];
  if (req.status === 'enriched' && req.fields) {
    let taken = false;
    if (req.fields.cnpj && isEmpty(lead.values.cnpj)) {
      const t = await ports.cnpjTaken(auth.orgId, req.fields.cnpj, lead.id);
      if (t === 'error') return unavailable();
      taken = t;
    }
    ({ patch, skipped } = computeEnrichmentPatch(lead.values, req.fields, taken));
  }

  // Nunca rebaixa um lead ja enriquecido por uma resposta posterior de falha.
  const status =
    req.status === 'enriched' ? 'enriched' : lead.enrichment_status === 'enriched' ? null : req.status === 'not_found' ? 'not_found' : 'enrichment_failed';

  const applied = Object.keys(patch);
  if (applied.length > 0 || status) {
    const ok = await ports.applyEnrichment({ orgId: auth.orgId, leadId: lead.id, patch, status, provider: req.provider });
    if (!ok) return unavailable();
  }

  const recorded = await ports.recordEvent({
    orgId: auth.orgId,
    leadId: lead.id,
    key,
    disposition: req.status,
    reasons: [...applied.map((f) => `set_${f}`), ...skipped],
  });
  if (recorded === 'error') return unavailable();

  return respond(200, {
    success: true,
    data: { idempotency_key: req.idempotency_key, replay: false, lead_id: lead.id, applied, skipped, next_action: 'none' },
  });
}
