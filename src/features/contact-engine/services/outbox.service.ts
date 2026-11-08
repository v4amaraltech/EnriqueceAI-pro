import type { ActionResult } from '@/lib/actions/action-result';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { ContactChannel, IsoTimestamp, MessageProvider, Uuid } from '../types';

import { normalizeContactIdentity } from './ownership.service';
import { evaluateSend, type SendGatewayRequest } from './send-decision.service';
import { isScopedFlagEnabled, type FlagScope } from './flag-scope.service';

/**
 * Outbox transacional de envio (PR07).
 *
 * Apenas ENFILEIRA e RESERVA. Nao ha consumidor, worker, cron nem chamada a
 * provedor: nada aqui despacha mensagem. A fila so cresce quando a flag
 * `send_outbox_enqueue` (app_flags, global, nasce desligada) esta ligada.
 *
 * Regras:
 *  - `enqueueSend` NAO aceita decisao pronta do chamador. Ele chama o gateway
 *    (`evaluateSend`) e so grava se a decisao for `allowed: true`; o comando
 *    gravado e derivado dessa decisao. Assim nao existe como enfileirar algo que
 *    o gateway nao autorizou.
 *  - A chave comercial (org, lead, canal, inscricao, etapa, tentativa) nao inclui
 *    provedor: dois provedores nunca executam a mesma acao.
 *  - `claimSend` reserva com lease e revalida supressao no banco. Flag desligada
 *    nao reserva (fail-closed).
 *  - `confirmSend` NAO exige a flag: registrar o resultado de algo que ja foi
 *    reservado nunca pode ser bloqueado, senao uma mensagem enviada ficaria sem
 *    registro. Timeout vira `uncertain`; nao ha retry cego nem fallback.
 *
 * Isolamento: usa service role, entao toda chamada carrega `orgId` e as RPCs
 * filtram por `org_id`.
 */
export const SEND_OUTBOX_FLAG_KEY = 'send_outbox_enqueue';

/** Validade do comando autorizado a partir da decisao. O consumidor (PR08) rejeita comando vencido. */
export const COMMAND_TTL_MS = 15 * 60 * 1000;

const DEFAULT_LEASE_SECONDS = 60;
const MAX_LEASE_SECONDS = 3600;
const MAX_ERROR_LENGTH = 300;

export type OutboxStatus =
  | 'pending'
  | 'reserved'
  | 'sending'
  | 'sent'
  /** PR08: entrega confirmada pelo provedor (callback). Ver reconcile_send. */
  | 'delivered'
  | 'failed'
  | 'uncertain'
  | 'suppressed'
  | 'cancelled';

/** Comando gravado em `send_outbox.command`. Sem corpo de mensagem, segredo ou token. */
export interface StoredSendCommand {
  provider: MessageProvider;
  senderInstanceId: Uuid | null;
  requiresTemplate: boolean;
  templateId: string | null;
  ownershipVersion: number;
  payloadHash: string;
  decidedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

type Failure = Extract<ActionResult<never>, { success: false }>;
const fail = (error: string, code: string): Failure => ({ success: false, error, code });

export async function isSendOutboxEnabled(scope?: FlagScope): Promise<boolean> {
  return isScopedFlagEnabled(SEND_OUTBOX_FLAG_KEY, scope);
}

/** Chave comercial serializada. Independente de provedor e de instancia. */
export function buildIdempotencyKey(input: {
  orgId: Uuid;
  leadId: Uuid;
  channel: ContactChannel;
  enrollmentId: Uuid | null;
  stepId: Uuid | null;
  attempt: number;
}): string {
  return [
    input.orgId,
    input.leadId,
    input.channel,
    input.enrollmentId ?? '-',
    input.stepId ?? '-',
    String(input.attempt),
  ].join(':');
}

interface RpcRow {
  outcome: string;
  outbox_id: string | null;
  status: string | null;
  version: number | null;
  [key: string]: unknown;
}

async function callRpc(fn: string, args: Record<string, unknown>) {
  try {
    const { data, error } = (await createServiceRoleClient().rpc(fn as never, args as never)) as unknown as {
      data: RpcRow[] | RpcRow | null;
      error: { message: string } | null;
    };
    if (error) return { row: null, failed: true as const };
    const row = Array.isArray(data) ? data[0] : data;
    return { row: row ?? null, failed: false as const };
  } catch {
    return { row: null, failed: true as const };
  }
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export interface EnqueueSendInput {
  /** Pedido ao gateway. O gateway e consultado aqui; o chamador nao entrega decisao. */
  request: SendGatewayRequest;
  /** Hash do payload fixado no enqueue (o executor nao o modifica). */
  payloadHash: string;
  /** Tentativa comercial explicita (padrao 1). Retry tecnico NAO incrementa. */
  attempt?: number;
  now?: Date;
}

export interface EnqueueSendResult {
  outboxId: Uuid;
  status: OutboxStatus;
  version: number;
  /** `duplicate`: a chave comercial ja existia; nada foi alterado. */
  outcome: 'enqueued' | 'duplicate';
  idempotencyKey: string;
}

const PAYLOAD_HASH = /^[a-f0-9]{32,128}$/i;

export async function enqueueSend(input: EnqueueSendInput): Promise<ActionResult<EnqueueSendResult>> {
  if (!(await isSendOutboxEnabled({ orgId: input.request.orgId }))) {
    return fail('Outbox de envio desativada', 'flag_disabled');
  }

  const { request } = input;
  const attempt = input.attempt ?? 1;
  if (!Number.isInteger(attempt) || attempt < 1) return fail('Tentativa invalida', 'invalid_input');
  if (!PAYLOAD_HASH.test(input.payloadHash ?? '')) return fail('Hash do payload invalido', 'invalid_input');
  if (request.requestedBy.orgId !== request.orgId) return fail('Organizacao do ator diverge do pedido', 'invalid_input');

  const identity = normalizeContactIdentity(request.channel, request.contact);
  if (!identity) return fail('Contato invalido para o canal', 'invalid_contact');

  const now = input.now ?? new Date();
  const decision = await evaluateSend(request, now);
  if (!decision.allowed) {
    return { success: false, error: 'Gateway nao autorizou o envio', code: 'gateway_denied' };
  }

  const command: StoredSendCommand = {
    provider: decision.provider,
    senderInstanceId: decision.senderInstanceId,
    requiresTemplate: decision.requiresTemplate,
    templateId: decision.templateId,
    ownershipVersion: decision.ownershipVersion,
    payloadHash: input.payloadHash.toLowerCase(),
    decidedAt: decision.decidedAt,
    expiresAt: new Date(Date.parse(decision.decidedAt) + COMMAND_TTL_MS).toISOString(),
  };
  const idempotencyKey = buildIdempotencyKey({
    orgId: request.orgId,
    leadId: request.leadId,
    channel: request.channel,
    enrollmentId: request.enrollmentId,
    stepId: request.stepId,
    attempt,
  });

  const { row, failed } = await callRpc('enqueue_send', {
    p_org_id: request.orgId,
    p_lead_id: request.leadId,
    p_channel: request.channel,
    p_contact_identity: identity,
    p_idempotency_key: idempotencyKey,
    p_provider: decision.provider,
    p_command: command,
  });
  if (failed || !row) return fail('Falha ao enfileirar envio', 'write_failed');

  switch (row.outcome) {
    case 'enqueued':
    case 'duplicate':
      return {
        success: true,
        data: {
          outboxId: String(row.outbox_id),
          status: row.status as OutboxStatus,
          version: Number(row.version),
          outcome: row.outcome,
          idempotencyKey,
        },
      };
    case 'flag_disabled':
      return fail('Outbox de envio desativada', 'flag_disabled');
    case 'lead_not_in_org':
      return fail('Lead nao encontrado', 'not_found');
    default:
      return fail('Resposta inesperada do banco', 'write_failed');
  }
}

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

export interface ClaimSendInput {
  orgId: Uuid;
  /** Identificador do worker que detem o lease. */
  leaseOwner: string;
  leaseSeconds?: number;
}

export interface ClaimedSend {
  outboxId: Uuid;
  leadId: Uuid;
  channel: ContactChannel;
  provider: MessageProvider;
  command: StoredSendCommand;
  version: number;
  attempts: number;
  leaseExpiresAt: IsoTimestamp;
}

export interface ClaimSendResult {
  /** null quando nao ha entrada reservavel. */
  claimed: ClaimedSend | null;
  /** Entradas marcadas `suppressed` nesta chamada (opt-out ou hold). */
  suppressed: number;
  /** Entradas `sending` com lease vencido, marcadas `uncertain` nesta chamada. */
  uncertain: number;
}

export async function claimSend(input: ClaimSendInput): Promise<ActionResult<ClaimSendResult>> {
  if (!(await isSendOutboxEnabled({ orgId: input.orgId }))) return fail('Outbox de envio desativada', 'flag_disabled');
  const owner = String(input.leaseOwner ?? '').trim();
  const leaseSeconds = input.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  if (!owner) return fail('Dono do lease obrigatorio', 'invalid_input');
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > MAX_LEASE_SECONDS) {
    return fail('Duracao do lease invalida', 'invalid_input');
  }

  const { row, failed } = await callRpc('claim_send', {
    p_org_id: input.orgId,
    p_lease_owner: owner,
    p_lease_seconds: leaseSeconds,
  });
  if (failed || !row) return fail('Falha ao reservar envio', 'write_failed');

  const counts = { suppressed: Number(row.suppressed_count ?? 0), uncertain: Number(row.uncertain_count ?? 0) };
  if (row.outcome === 'empty') return { success: true, data: { claimed: null, ...counts } };
  if (row.outcome !== 'claimed') return fail('Resposta inesperada do banco', 'write_failed');

  return {
    success: true,
    data: {
      claimed: {
        outboxId: String(row.outbox_id),
        leadId: String(row.lead_id),
        channel: row.channel as ContactChannel,
        provider: row.provider as MessageProvider,
        command: row.command as StoredSendCommand,
        version: Number(row.version),
        attempts: Number(row.attempts),
        leaseExpiresAt: String(row.lease_expires_at),
      },
      ...counts,
    },
  };
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

export type ConfirmTarget = 'sending' | 'sent' | 'failed' | 'uncertain' | 'cancelled';

export interface ConfirmSendInput {
  orgId: Uuid;
  outboxId: Uuid;
  /** CAS: versao devolvida pelo claim ou pela confirmacao anterior. */
  expectedVersion: number;
  leaseOwner: string;
  target: ConfirmTarget;
  /** Obrigatorio para `sent`: id devolvido pelo provedor. */
  externalId?: string | null;
  /** Motivo curto (sem corpo de mensagem nem segredo). */
  error?: string | null;
}

export interface ConfirmSendResult {
  outboxId: Uuid;
  status: OutboxStatus;
  version: number;
  /** `suppressed`: a revalidacao antes do envio barrou; NAO enviar. */
  outcome: 'confirmed' | 'suppressed';
}

export async function confirmSend(input: ConfirmSendInput): Promise<ActionResult<ConfirmSendResult>> {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return fail('Versao esperada invalida', 'invalid_input');
  }
  const owner = String(input.leaseOwner ?? '').trim();
  if (!owner) return fail('Dono do lease obrigatorio', 'invalid_input');
  const externalId = String(input.externalId ?? '').trim();
  if (input.target === 'sent' && !externalId) return fail('external_id obrigatorio para sent', 'invalid_input');

  const { row, failed } = await callRpc('confirm_send', {
    p_org_id: input.orgId,
    p_outbox_id: input.outboxId,
    p_expected_version: input.expectedVersion,
    p_lease_owner: owner,
    p_target: input.target,
    p_external_id: externalId || null,
    p_error: input.error ? String(input.error).slice(0, MAX_ERROR_LENGTH) : null,
  });
  if (failed || !row) return fail('Falha ao confirmar envio', 'write_failed');

  switch (row.outcome) {
    case 'confirmed':
    case 'suppressed':
      return {
        success: true,
        data: {
          outboxId: String(row.outbox_id),
          status: row.status as OutboxStatus,
          version: Number(row.version),
          outcome: row.outcome,
        },
      };
    case 'version_conflict':
      return fail('Versao desatualizada: a entrada mudou', 'version_conflict');
    case 'lease_mismatch':
      return fail('Lease pertence a outro worker', 'lease_mismatch');
    case 'invalid_transition':
      return fail('Transicao de estado invalida', 'invalid_transition');
    case 'not_found':
      return fail('Entrada nao encontrada', 'not_found');
    case 'invalid_input':
      return fail('Entrada invalida', 'invalid_input');
    default:
      return fail('Resposta inesperada do banco', 'write_failed');
  }
}

/** Atalho: timeout do provedor vira `uncertain` (a mensagem pode ter saido). */
export function markUncertainOnTimeout(
  input: Omit<ConfirmSendInput, 'target' | 'externalId' | 'error'>,
): Promise<ActionResult<ConfirmSendResult>> {
  return confirmSend({ ...input, target: 'uncertain', error: 'provider_timeout' });
}
