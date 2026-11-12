/**
 * Matching helpers for the API4COM reconcile worker
 * (`src/app/api/workers/reconcile-api4com-calls/route.ts`).
 *
 * Without webhooks (org V4 Company Julio Cesar, set/2026) every REST call is
 * linked to a dialer row by the origin + destination + ±10min fallback. SDRs
 * redial the same number 2-3 times within minutes, and the old fallback
 * always took the OLDEST row in the window, never skipping rows already
 * linked to another API4COM call, while 10 calls ran in parallel. Result on
 * the 2026-09-10 backfill: several REST calls piled onto the same row
 * (overwriting each other), 648 dialer rows stayed blank and ~34 duplicates
 * were inserted.
 *
 * Fix: process calls to the same ramal + number sequentially in time order
 * (groupCallsForReconcile) and link each one to the CLOSEST row that is not
 * linked yet (pickFallbackCandidate).
 *
 * Ligações originadas com `metadata.callRef` (o `calls.id`) casam antes de
 * tudo pelo callRef (`resolveReconcileMatch`), sem janela de tempo.
 */
import { findCallByCallRef, linkProviderIdToMetadata, readCallRef } from './api4com-call-ref';

interface GroupableCall {
  from?: string;
  to?: string;
  started_at?: string;
}

export interface FallbackCandidate {
  id: string;
  started_at: string | null;
  hangup_cause: string | null;
  metadata: Record<string, unknown> | null;
}

/** Last 8 digits of a phone number — same suffix the fallback query uses. */
export function destinationSuffix(destination: string): string {
  return destination.replace(/\D/g, '').slice(-8);
}

/**
 * Group calls by ramal + destination suffix, each group sorted by started_at
 * ascending. Groups can be processed in parallel; calls inside a group must
 * run one after the other so they never compete for the same dialer row.
 * Calls without from/to can't use the fallback and get a group of their own.
 */
export function groupCallsForReconcile<T extends GroupableCall>(calls: T[]): T[][] {
  const groups = new Map<string, T[]>();
  const singles: T[][] = [];

  for (const c of calls) {
    if (!c.from || !c.to) {
      singles.push([c]);
      continue;
    }
    const key = `${c.from}|${destinationSuffix(c.to)}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const startedMs = (c: T) => (c.started_at ? Date.parse(c.started_at) : 0);
  const sorted = [...groups.values()].map((g) => [...g].sort((a, b) => startedMs(a) - startedMs(b)));
  return [...sorted, ...singles];
}

/**
 * A row already carries an API4COM call when a webhook or a previous
 * reconcile linked it (`webhook_linked`, `alt_api4com_ids`) or when the
 * reconcile itself inserted it. Such rows must not absorb another call.
 */
export function isLinkedToApi4ComCall(metadata: Record<string, unknown> | null): boolean {
  if (!metadata) return false;
  if (metadata.webhook_linked === true || metadata.webhook_linked === 'true') return true;
  if (metadata.source === 'reconcile_api4com') return true;
  return Array.isArray(metadata.alt_api4com_ids) && metadata.alt_api4com_ids.length > 0;
}

/**
 * Pick the dialer row to link an incoming REST call to: not linked yet,
 * hangup_cause compatible (either side null, or equal), and closest in time.
 * Ties go to the earliest row. Returns null when nothing qualifies — the
 * caller then inserts the call as a new row.
 */
export function pickFallbackCandidate<T extends FallbackCandidate>(
  candidates: T[],
  targetStartedMs: number,
  incomingHangupCause: string | null | undefined,
): T | null {
  let best: T | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  let bestStarted = Number.POSITIVE_INFINITY;

  for (const row of candidates) {
    if (isLinkedToApi4ComCall(row.metadata)) continue;
    if (row.hangup_cause && incomingHangupCause && row.hangup_cause !== incomingHangupCause) continue;
    if (!row.started_at) continue;

    const started = Date.parse(row.started_at);
    if (Number.isNaN(started)) continue;
    const diff = Math.abs(started - targetStartedMs);

    if (diff < bestDiff || (diff === bestDiff && started < bestStarted)) {
      best = row;
      bestDiff = diff;
      bestStarted = started;
    }
  }

  return best;
}

/** Registro do GET /calls, só com o que o casamento usa. */
export interface ReconcileIncomingCall {
  id?: string;
  from?: string;
  to?: string;
  started_at?: string;
  hangup_cause?: string | null;
  call_type?: string;
  metadata?: Record<string, unknown> | null;
}

export type ReconcileMatchVia = 'call_ref' | 'primary_id' | 'alt_id' | 'fallback';

export interface ReconcileLookups<T extends FallbackCandidate> {
  byId: (id: string) => Promise<T | null>;
  byCallRefMetadata: (callRef: string) => Promise<T | null>;
  byPrimaryId: (api4comId: string) => Promise<T | null>;
  byAltId: (api4comId: string) => Promise<T | null>;
  fallbackCandidates: (params: { origin: string; suffix: string; loIso: string; hiIso: string }) => Promise<T[]>;
}

/** Meia janela do fallback por horário. */
export const RECONCILE_FALLBACK_WINDOW_MS = 10 * 60 * 1000;

/**
 * Acha a linha local de um registro REST. Ordem:
 *  0) `metadata.callRef` (o `calls.id` enviado no POST /calls): determinístico,
 *     sem o gate de hangup_cause (a linha é a tentativa certa mesmo com hangup
 *     vazio ou diferente);
 *  1a) `api4com_call_id`; 1b) `alt_api4com_ids` com gate de hangup_cause;
 *  2) fallback ramal + sufixo do destino + started_at ±10 min (`pickFallbackCandidate`).
 * Ligações antigas, sem callRef, seguem exatamente o caminho de antes.
 */
export async function resolveReconcileMatch<T extends FallbackCandidate>(
  call: ReconcileIncomingCall,
  lookups: ReconcileLookups<T>,
): Promise<{ row: T; via: ReconcileMatchVia } | null> {
  const api4comId = call.id;
  if (!api4comId) return null;

  const byRef = await findCallByCallRef(readCallRef(call.metadata), {
    byId: lookups.byId,
    byMetadata: lookups.byCallRefMetadata,
  });
  if (byRef) return { row: byRef, via: 'call_ref' };

  const primary = await lookups.byPrimaryId(api4comId);
  if (primary) return { row: primary, via: 'primary_id' };

  // Secondary lookups (alt-id, time fallback) must respect hangup_cause: a
  // voicemail (NUMBER_CHANGED) and a connected call (NORMAL_CLEARING) to the
  // same destination minutes apart are DIFFERENT events. Allow if either side
  // is null (dialer row pending webhook, or legacy row) OR if both match.
  const hangupCompatible = (existingHc: string | null): boolean =>
    existingHc === null || call.hangup_cause === null || call.hangup_cause === undefined || existingHc === call.hangup_cause;

  const alt = await lookups.byAltId(api4comId);
  if (alt && hangupCompatible(alt.hangup_cause)) return { row: alt, via: 'alt_id' };

  if (call.from && call.to && call.started_at) {
    const startedMs = Date.parse(call.started_at);
    const candidates = await lookups.fallbackCandidates({
      origin: call.from,
      suffix: destinationSuffix(call.to),
      loIso: new Date(startedMs - RECONCILE_FALLBACK_WINDOW_MS).toISOString(),
      hiIso: new Date(startedMs + RECONCILE_FALLBACK_WINDOW_MS).toISOString(),
    });
    const picked = pickFallbackCandidate(candidates, startedMs, call.hangup_cause);
    if (picked) return { row: picked, via: 'fallback' };
  }

  return null;
}

/**
 * Metadata a gravar numa linha casada, ou null se não muda. Pelo callRef:
 * merge que grava o id do provedor (ou alt) e `webhook_linked`, preservando
 * callRef e gateway. Nos outros casos, o comportamento de antes: id diferente do
 * primário vai para `alt_api4com_ids` com `webhook_linked`.
 */
export function reconcileLinkMetadata(
  existing: Record<string, unknown> | null,
  api4comId: string,
  via: ReconcileMatchVia,
): Record<string, unknown> | null {
  const existingMeta = existing ?? {};
  if (via === 'call_ref') {
    const { metadata, changed } = linkProviderIdToMetadata(existingMeta, api4comId, { webhookLinked: true });
    return changed ? metadata : null;
  }
  if (existingMeta.api4com_call_id === api4comId) return null;
  const altIds = Array.isArray(existingMeta.alt_api4com_ids) ? (existingMeta.alt_api4com_ids as string[]) : [];
  if (altIds.includes(api4comId)) return null;
  return { ...existingMeta, alt_api4com_ids: [...altIds, api4comId], webhook_linked: true };
}

/** Metadata de uma linha nova inserida pelo reconcile (webhook nunca chegou). */
export function reconcileInsertMetadata(call: ReconcileIncomingCall, api4comId: string): Record<string, unknown> {
  const callRef = readCallRef(call.metadata);
  return {
    api4com_call_id: api4comId,
    source: 'reconcile_api4com',
    hangup_cause: call.hangup_cause ?? null,
    // Captured so future gap-analysis can filter API4COM call_type
    // (internal/transfer/etc.) post-hoc, see briefing
    // docs/briefings/2026-05-17-gap-enriquece-api4com.md.
    call_type: call.call_type ?? null,
    ...(callRef ? { callRef } : {}),
  };
}
