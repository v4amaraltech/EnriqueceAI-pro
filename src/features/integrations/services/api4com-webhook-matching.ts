/**
 * Casamento de um evento do webhook da API4COM (`channel-answer` /
 * `channel-hangup`) com a linha local em `calls`. A route faz as queries; este
 * módulo decide a ordem e o que gravar no metadata.
 *
 * Ordem:
 *  0) `metadata.callRef` do evento (o `calls.id` que enviamos no POST /calls):
 *     pela chave primária, depois por `metadata->>callRef`. Não depende de
 *     `orgScope`, o UUID é nosso e único. Achou: grava o id do provedor e
 *     `webhook_linked` como merge (preserva callRef, gateway e o resto).
 *  1a) `metadata->>api4com_call_id`.
 *  1b) `alt_api4com_ids` (a API4COM já emitiu dois ids para a mesma ligação).
 *  2) Fallback ramal + telefone + 2 h, só dentro de `orgScope`. Fica para
 *     ligações antigas, sem callRef.
 */
import { findCallByCallRef, linkProviderIdToMetadata, readCallRef } from './api4com-call-ref';

export interface WebhookMatchedCall {
  id: string;
  metadata: Record<string, unknown> | null;
}

export interface WebhookMatchEvent {
  id: string;
  caller: string;
  called: string;
  domain?: string;
  metadata?: Record<string, unknown> | null;
}

export type WebhookMatchVia = 'call_ref' | 'primary_id' | 'alt_id' | 'fallback';

export interface WebhookCallStore<T extends WebhookMatchedCall> {
  findById: (id: string) => Promise<T | null>;
  findByCallRefMetadata: (callRef: string) => Promise<T | null>;
  findByPrimaryId: (api4comId: string) => Promise<T | null>;
  findByAltId: (api4comId: string) => Promise<T | null>;
  /** Linha mais antiga ainda não casada, do ramal + sufixo do telefone, desde `sinceIso`. */
  findFallback: (params: { orgScope: string[]; caller: string; calledSuffix: string; sinceIso: string }) => Promise<T | null>;
  updateMetadata: (id: string, metadata: Record<string, unknown>) => Promise<void>;
}

export interface WebhookMatchLogger {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
}

const FALLBACK_WINDOW_MS = 2 * 60 * 60 * 1000;

export async function findWebhookCall<T extends WebhookMatchedCall>(
  store: WebhookCallStore<T>,
  event: WebhookMatchEvent,
  orgScope: string[],
  options: { now?: number; logger?: WebhookMatchLogger } = {},
): Promise<{ call: T; via: WebhookMatchVia } | null> {
  const logger = options.logger;

  // 0) callRef
  const callRef = readCallRef(event.metadata);
  const byRef = await findCallByCallRef(callRef, {
    byId: store.findById,
    byMetadata: store.findByCallRefMetadata,
  });
  if (byRef) {
    const { metadata, changed } = linkProviderIdToMetadata(byRef.metadata, event.id, { webhookLinked: true });
    if (changed) {
      await store.updateMetadata(byRef.id, metadata);
      logger?.info('Linked api4com id via callRef', { callId: byRef.id, api4comId: event.id });
    }
    return { call: { ...byRef, metadata }, via: 'call_ref' };
  }

  // 1a) Primary id match
  const primary = await store.findByPrimaryId(event.id);
  if (primary) return { call: primary, via: 'primary_id' };

  // 1b) Secondary id match: API4COM emits 2 different ids for the same call
  // (channel_id vs request_id from /dialer). When the primary holds id A and
  // this event carries id B, the row's metadata.alt_api4com_ids remembers B so
  // future events on either id hit the same row.
  const alt = await store.findByAltId(event.id);
  if (alt) return { call: alt, via: 'alt_id' };

  // Domínio desconhecido com todas as orgs já mapeadas → não casar por ramal.
  if (orgScope.length === 0) {
    logger?.warn('Fallback skipped: no org for event domain', { api4comId: event.id, domain: event.domain });
    return null;
  }

  // 2) Fallback: caller (ramal) + called (phone) within last 2 hours, only
  // rows not linked to a previous webhook event yet, oldest first (the
  // store filters `webhook_linked IS NULL`). Without that filter, every
  // retry to the same number within 2h collapsed onto the first row (we lost
  // 12 calls on 2026-05-14 V4 Amaral this way).
  const calledSuffix = String(event.called ?? '').replace(/\D/g, '').slice(-8);
  const sinceIso = new Date((options.now ?? Date.now()) - FALLBACK_WINDOW_MS).toISOString();
  const fallback = await store.findFallback({ orgScope, caller: event.caller, calledSuffix, sinceIso });
  if (!fallback) return null;

  // Persist via alt_api4com_ids (don't overwrite primary id). Keeps the
  // primary stable so the dashboard CSV's id (when that's what landed first)
  // remains the authoritative one.
  const existingMeta = (fallback.metadata ?? {}) as Record<string, unknown>;
  if (existingMeta.api4com_call_id !== event.id) {
    const altIds = Array.isArray(existingMeta.alt_api4com_ids) ? (existingMeta.alt_api4com_ids as string[]) : [];
    if (!altIds.includes(event.id)) {
      await store.updateMetadata(fallback.id, {
        ...existingMeta,
        alt_api4com_ids: [...altIds, event.id],
        webhook_linked: true,
      });
      logger?.info('Saved alt api4com_call_id via fallback match', { callId: fallback.id, api4comId: event.id });
    }
  } else {
    // Same primary id (rare with this path, only if metadata was wiped).
    await store.updateMetadata(fallback.id, { ...existingMeta, webhook_linked: true });
  }

  return { call: fallback, via: 'fallback' };
}
