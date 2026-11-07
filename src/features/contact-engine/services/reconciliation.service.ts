import type { ActionResult } from '@/lib/actions/action-result';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { MessageProvider, Uuid } from '../types';

import {
  isDispatcherEnabled,
  logDispatcher,
  MAX_DISPATCH_ATTEMPTS,
  revalidateEntry,
  type DispatchEntry,
  type PayloadResolver,
  type ProviderAdapters,
} from './dispatcher.service';
import { COMMAND_TTL_MS, type OutboxStatus, type StoredSendCommand } from './outbox.service';

/**
 * Reconciliacao da outbox (PR08).
 *
 * Resolve o que o dispatcher nao conseguiu fechar: `uncertain` e `sending` com
 * lease vencido. Tambem aplica eventos do provedor (callbacks) por `external_id`.
 *
 * Regras:
 *  - Fonte da verdade e o provedor, nunca o relogio. Passar tempo sem resposta nao
 *    prova que a mensagem nao saiu: sem confirmacao, a entrada continua `uncertain`.
 *  - Retry (`uncertain` -> `pending`) SOMENTE quando o adaptador consulta o provedor
 *    e ele confirma que nao houve aceitacao (`not_accepted`), depois de
 *    `RECONCILE_SETTLE_MS` (consistencia eventual) e de o gateway autorizar de
 *    novo com o mesmo provedor e instancia. O comando e renovado a partir dessa
 *    nova decisao; nunca se troca provedor, numero ou canal.
 *  - Callbacks fora de ordem e repetidos sao idempotentes: o estado nunca regride
 *    (`delivered` nao volta a `sent`) e a repeticao devolve `noop`. A RPC
 *    `reconcile_send` aplica a regra com lock de linha e CAS por `version`.
 *  - `reconcileOnce` respeita a flag `dispatcher_v1`. `applyProviderEvent` so
 *    registra um fato do provedor sobre uma entrada existente (como `confirmSend`);
 *    nada o chama neste PR.
 */

/** Espera minima antes de aceitar "nao encontrado" como prova de nao aceitacao. */
export const RECONCILE_SETTLE_MS = 10 * 60 * 1000;
const DEFAULT_LIMIT = 20;
const MAX_CAS_RETRIES = 3;

type Db = ReturnType<typeof createServiceRoleClient>;
type Failure = Extract<ActionResult<never>, { success: false }>;
const fail = (error: string, code: string): Failure => ({ success: false, error, code });

interface RpcRow {
  outcome: string;
  outbox_id: string | null;
  status: string | null;
  version: number | null;
}

export type ReconcileTarget = 'sent' | 'delivered' | 'failed' | 'pending' | 'cancelled';

export interface ReconcileCallInput {
  orgId: Uuid;
  outboxId: Uuid;
  expectedVersion: number;
  target: ReconcileTarget;
  source: string;
  externalId?: string | null;
  error?: string | null;
  commandPatch?: Partial<StoredSendCommand> | null;
}

export type ReconcileCallOutcome = 'confirmed' | 'noop' | 'version_conflict' | 'external_id_mismatch' | 'invalid_transition' | 'not_found';

export async function reconcileSend(
  input: ReconcileCallInput,
): Promise<ActionResult<{ outcome: ReconcileCallOutcome; status: OutboxStatus | null; version: number | null }>> {
  let data: RpcRow[] | RpcRow | null;
  let error: { message: string } | null;
  try {
    ({ data, error } = (await createServiceRoleClient().rpc('reconcile_send' as never, {
      p_org_id: input.orgId,
      p_outbox_id: input.outboxId,
      p_expected_version: input.expectedVersion,
      p_target: input.target,
      p_source: input.source,
      p_external_id: input.externalId?.trim() || null,
      p_error: input.error ? String(input.error).slice(0, 300) : null,
      p_command_patch: input.commandPatch ?? null,
    } as never)) as unknown as { data: RpcRow[] | RpcRow | null; error: { message: string } | null });
  } catch {
    return fail('Falha ao reconciliar envio', 'write_failed');
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return fail('Falha ao reconciliar envio', 'write_failed');
  switch (row.outcome) {
    case 'confirmed':
    case 'noop':
    case 'version_conflict':
    case 'external_id_mismatch':
    case 'invalid_transition':
    case 'not_found':
      return {
        success: true,
        data: {
          outcome: row.outcome,
          status: (row.status as OutboxStatus | null) ?? null,
          version: row.version == null ? null : Number(row.version),
        },
      };
    case 'invalid_input':
      return fail('Entrada invalida', 'invalid_input');
    default:
      return fail('Resposta inesperada do banco', 'write_failed');
  }
}

// ---------------------------------------------------------------------------
// Callbacks do provedor
// ---------------------------------------------------------------------------

export type ProviderEventStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface ProviderEvent {
  orgId: Uuid;
  /** Id da mensagem no provedor. */
  externalId: string;
  /** Se o callback ja carrega o id da entrada (ex.: Message-ID deterministico), acelera o casamento. */
  outboxId?: Uuid | null;
  status: ProviderEventStatus;
  error?: string | null;
  /** Origem do evento (ex.: `meta_webhook`). Vai para a trilha, sem segredo. */
  source: string;
}

export type ProviderEventOutcome =
  | 'applied'
  /** Repeticao ou evento antigo: nada mudou. */
  | 'noop'
  /** Nenhuma entrada com este id (ainda). O chamador deve tentar de novo mais tarde. */
  | 'unmatched';

interface OutboxLookupRow {
  id: string;
  status: OutboxStatus;
  version: number;
  external_id: string | null;
}

async function findEntry(db: Db, event: ProviderEvent): Promise<OutboxLookupRow[] | null> {
  const base = from(db, 'send_outbox').select('id, status, version, external_id').eq('org_id', event.orgId);
  const query = event.outboxId ? base.eq('id', event.outboxId) : base.eq('external_id', event.externalId);
  const { data, error } = (await query.limit(2)) as {
    data: OutboxLookupRow[] | null;
    error?: { message: string } | null;
  };
  if (error || !data) return null;
  return data;
}

const EVENT_TARGET: Record<ProviderEventStatus, ReconcileTarget> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'delivered',
  failed: 'failed',
};

export async function applyProviderEvent(event: ProviderEvent): Promise<ActionResult<{ outcome: ProviderEventOutcome; status: OutboxStatus | null }>> {
  const externalId = String(event.externalId ?? '').trim();
  const source = String(event.source ?? '').trim();
  if (!externalId || !source) return fail('Evento invalido', 'invalid_input');
  const target = EVENT_TARGET[event.status];
  if (!target) return fail('Status do evento invalido', 'invalid_input');

  const db = createServiceRoleClient();
  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    let rows: OutboxLookupRow[] | null;
    try {
      rows = await findEntry(db, { ...event, externalId });
    } catch {
      return fail('Falha ao localizar entrada', 'read_failed');
    }
    if (!rows) return fail('Falha ao localizar entrada', 'read_failed');
    if (rows.length === 0) return { success: true, data: { outcome: 'unmatched', status: null } };
    if (rows.length > 1) return fail('Mais de uma entrada para o mesmo id do provedor', 'ambiguous_match');
    const row = rows[0]!;

    const res = await reconcileSend({
      orgId: event.orgId,
      outboxId: row.id,
      expectedVersion: row.version,
      target,
      source,
      externalId,
      error: event.error ?? null,
    });
    if (!res.success) return res;
    switch (res.data.outcome) {
      case 'confirmed':
        return { success: true, data: { outcome: 'applied', status: res.data.status } };
      case 'noop':
        return { success: true, data: { outcome: 'noop', status: res.data.status } };
      case 'version_conflict':
        continue; // outro processo mudou a linha: le de novo e reavalia
      case 'not_found':
        return { success: true, data: { outcome: 'unmatched', status: null } };
      case 'external_id_mismatch':
        return fail('A entrada ja tem outro id de provedor', 'external_id_mismatch');
      case 'invalid_transition':
        return fail('Transicao invalida para o estado atual', 'invalid_transition');
    }
  }
  return fail('Conflito de versao persistente', 'version_conflict');
}

// ---------------------------------------------------------------------------
// Varredura
// ---------------------------------------------------------------------------

export interface ReconcileInput {
  orgId: Uuid;
  resolver: PayloadResolver;
  adapters: ProviderAdapters;
  limit?: number;
  settleMs?: number;
  now?: () => Date;
}

export interface ReconcileRunResult {
  enabled: boolean;
  reason: string | null;
  examined: number;
  /** Provedor confirmou a aceitacao: `sent`. */
  resolvedSent: number;
  /** Provedor confirmou a nao aceitacao e o retry foi liberado: `pending`. */
  retryScheduled: number;
  /** Nao aceita e sem tentativas restantes: `failed`. */
  failed: number;
  /** Nao aceita, mas o gateway nao autoriza mais: `cancelled`. */
  cancelled: number;
  /** Sem resposta conclusiva: continua `uncertain`. */
  stillUncertain: number;
  /** Aguardando a janela de consistencia. */
  waiting: number;
}

const emptyRun = (enabled: boolean, reason: string | null): ReconcileRunResult => ({
  enabled,
  reason,
  examined: 0,
  resolvedSent: 0,
  retryScheduled: 0,
  failed: 0,
  cancelled: 0,
  stillUncertain: 0,
  waiting: 0,
});

interface CandidateRow {
  id: string;
  lead_id: string;
  channel: DispatchEntry['channel'];
  provider: MessageProvider;
  contact_identity: string;
  command: StoredSendCommand;
  status: OutboxStatus;
  version: number;
  attempts: number;
  updated_at: string;
  lease_expires_at: string | null;
}

async function listCandidates(db: Db, orgId: Uuid, limit: number, now: Date): Promise<CandidateRow[] | null> {
  const columns = 'id, lead_id, channel, provider, contact_identity, command, status, version, attempts, updated_at, lease_expires_at';
  const [uncertain, sending] = await Promise.all([
    from(db, 'send_outbox').select(columns).eq('org_id', orgId).eq('status', 'uncertain').order('updated_at', { ascending: true }).limit(limit) as unknown as Promise<{
      data: CandidateRow[] | null;
      error?: { message: string } | null;
    }>,
    from(db, 'send_outbox')
      .select(columns)
      .eq('org_id', orgId)
      .eq('status', 'sending')
      .lt('lease_expires_at', now.toISOString())
      .order('updated_at', { ascending: true })
      .limit(limit) as unknown as Promise<{ data: CandidateRow[] | null; error?: { message: string } | null }>,
  ]);
  if (uncertain.error || sending.error || !uncertain.data || !sending.data) return null;
  return [...uncertain.data, ...sending.data].slice(0, limit);
}

export async function reconcileOnce(input: ReconcileInput): Promise<ReconcileRunResult> {
  if (!(await isDispatcherEnabled())) return emptyRun(false, 'flag_disabled');
  const result = emptyRun(true, null);
  const now = input.now ?? (() => new Date());
  const settleMs = input.settleMs ?? RECONCILE_SETTLE_MS;

  let candidates: CandidateRow[] | null;
  try {
    candidates = await listCandidates(createServiceRoleClient(), input.orgId, input.limit ?? DEFAULT_LIMIT, now());
  } catch {
    candidates = null;
  }
  if (!candidates) return { ...result, reason: 'read_failed' };

  for (const row of candidates) {
    result.examined += 1;
    try {
      const verdict = await reconcileCandidate(input, row, settleMs, now);
      result[verdict] += 1;
    } catch (err) {
      result.stillUncertain += 1;
      console.error('[reconciliation] erro inesperado na entrada', row.id, err instanceof Error ? err.name : 'erro');
    }
  }
  return result;
}

type Verdict = 'resolvedSent' | 'retryScheduled' | 'failed' | 'cancelled' | 'stillUncertain' | 'waiting';

async function reconcileCandidate(
  input: ReconcileInput,
  row: CandidateRow,
  settleMs: number,
  now: () => Date,
): Promise<Verdict> {
  const { orgId } = input;
  const updatedAt = Date.parse(row.updated_at);
  if (Number.isNaN(updatedAt) || now().getTime() - updatedAt < settleMs) return 'waiting';

  const adapter = input.adapters[row.provider];
  if (!adapter?.lookup) return 'stillUncertain';

  const entry: DispatchEntry = {
    orgId,
    outboxId: row.id,
    leadId: row.lead_id,
    channel: row.channel,
    provider: row.provider,
    command: row.command,
    contact: row.contact_identity,
    attempts: row.attempts,
  };
  const payload = await input.resolver.resolve(entry);
  if (!payload) return 'stillUncertain';

  const lookup = await adapter.lookup({
    orgId,
    outboxId: row.id,
    leadId: row.lead_id,
    to: row.contact_identity,
    payload,
    command: row.command,
  });

  if (lookup.kind === 'unknown') return 'stillUncertain';

  if (lookup.kind === 'accepted') {
    const res = await reconcileSend({
      orgId,
      outboxId: row.id,
      expectedVersion: row.version,
      target: 'sent',
      source: 'provider_lookup',
      externalId: lookup.externalId,
    });
    return res.success && (res.data.outcome === 'confirmed' || res.data.outcome === 'noop') ? 'resolvedSent' : 'stillUncertain';
  }

  // not_accepted: o provedor confirmou que nada foi aceito. So aqui o retry e possivel.
  if (row.attempts >= MAX_DISPATCH_ATTEMPTS) {
    const res = await reconcileSend({
      orgId,
      outboxId: row.id,
      expectedVersion: row.version,
      target: 'failed',
      source: 'provider_lookup',
      error: 'not_accepted_max_attempts',
    });
    return res.success && res.data.outcome === 'confirmed' ? 'failed' : 'stillUncertain';
  }

  const revalidation = await revalidateEntry(entry, payload, now());
  if (!revalidation.ok) {
    // Contexto indisponivel: nao decide agora. Negado de fato: confirma que nao sai.
    if (revalidation.retryable) return 'stillUncertain';
    const res = await reconcileSend({
      orgId,
      outboxId: row.id,
      expectedVersion: row.version,
      target: 'cancelled',
      source: 'provider_lookup',
      error: revalidation.reason.slice(0, 120),
    });
    return res.success && res.data.outcome === 'confirmed' ? 'cancelled' : 'stillUncertain';
  }

  // Nova decisao do gateway renova a validade do comando (mesmo provedor e instancia).
  const decidedAt = now();
  const res = await reconcileSend({
    orgId,
    outboxId: row.id,
    expectedVersion: row.version,
    target: 'pending',
    source: 'provider_lookup',
    commandPatch: {
      decidedAt: decidedAt.toISOString(),
      expiresAt: new Date(decidedAt.getTime() + COMMAND_TTL_MS).toISOString(),
    },
  });
  if (res.success && res.data.outcome === 'confirmed') {
    logDispatcher('reconciliation_retry_scheduled', { orgId, outboxId: row.id, provider: row.provider });
    return 'retryScheduled';
  }
  return 'stillUncertain';
}
