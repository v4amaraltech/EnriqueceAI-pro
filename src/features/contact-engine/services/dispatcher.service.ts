import { createHash } from 'crypto';

import type { ActionResult } from '@/lib/actions/action-result';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { ActorIdentity, ContactChannel, MessageProvider, Uuid } from '../types';

import {
  claimSend,
  confirmSend,
  type ClaimedSend,
  type ConfirmSendResult,
  type ConfirmTarget,
  type StoredSendCommand,
} from './outbox.service';
import { checkDispatchHealth, recordNumberHealthSignals, type DispatchHealthCheck } from './number-health.service';
import { evaluateSend, type SendGatewayRequest } from './send-decision.service';

/**
 * Dispatcher da outbox de envio (PR08).
 *
 * Unico executor das entradas da `send_outbox`: consome via `claim_send`,
 * revalida, transiciona para `sending`, chama UM adaptador de provedor e confirma
 * via `confirm_send`. Uma acao comercial tem uma autoridade de execucao: a chave
 * idempotente (org, lead, canal, inscricao, etapa, tentativa) e unica, o lease e
 * exclusivo e toda transicao e CAS por `version`.
 *
 * Regras:
 *  - Flag `dispatcher_v1` (app_flags, global, nasce desligada). Desligada ou
 *    ilegivel: nada e lido da fila nem enviado (fail-closed para ENVIO).
 *  - Antes de enviar: comando nao vencido, hash do payload confere, gateway
 *    (`evaluateSend`) permite de novo com o MESMO provedor e instancia, e a
 *    passagem para `sending` revalida holds e opt-out no banco (`confirm_send`).
 *    Qualquer falha cancela ou adia; nunca envia "na duvida".
 *  - Depois que a chamada ao provedor comecou, timeout, excecao ou resposta
 *    ambigua viram `uncertain`. Nunca ha reenvio cego nem fallback para outro
 *    provedor, numero ou canal. Retry so pela reconciliacao.
 *  - Nao ha rotacao nem escolha de numero: o provedor e a instancia vem do comando
 *    autorizado pelo gateway.
 *  - Saude e tetos por numero (PR10): so para o provedor `evolution` e so com a flag
 *    `number_health_v1` ligada (desligada: nenhuma leitura extra alem da flag, nenhuma
 *    escrita, fluxo identico). Teto esgotado adia (a fila espera); numero pausado ou em
 *    revisao cancela. Nunca troca de instancia para contornar. Depois da chamada ao
 *    provedor, o envio (aceito ou incerto) e somado a janela do dia.
 *  - Logs: somente ids e motivos. Sem telefone, e-mail, corpo ou segredos.
 */
export const DISPATCHER_FLAG_KEY = 'dispatcher_v1';

/** Tentativas de reserva antes de desistir de uma entrada que nunca chega ao envio. */
export const MAX_DISPATCH_ATTEMPTS = 5;
/** Tempo maximo de espera do provedor. Menor que o lease para o lease nunca vencer durante a chamada. */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 25_000;
export const DEFAULT_LEASE_SECONDS = 90;
export const DEFAULT_MAX_ITEMS = 10;

export async function isDispatcherEnabled(): Promise<boolean> {
  try {
    const { data, error } = (await from(createServiceRoleClient(), 'app_flags')
      .select('enabled')
      .eq('key', DISPATCHER_FLAG_KEY)
      .limit(1)) as { data: Array<{ enabled: boolean }> | null; error?: { message: string } | null };
    if (error) return false;
    return data?.[0]?.enabled === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Contratos de payload e provedor
// ---------------------------------------------------------------------------

/** O que o dispatcher precisa saber da entrada, alem do comando autorizado. */
export interface DispatchEntry {
  orgId: Uuid;
  outboxId: Uuid;
  leadId: Uuid;
  channel: ContactChannel;
  provider: MessageProvider;
  command: StoredSendCommand;
  /** Identidade normalizada do destinatario (digitos ou e-mail em minusculas). */
  contact: string;
  attempts: number;
}

/** Conteudo resolvido no momento do envio. A outbox guarda so o hash. */
export interface DispatchPayload {
  body: string;
  subject?: string;
  templateParams?: string[];
  /** Ator que autorizou a acao no enqueue; usado para revalidar dono e modo. */
  requestedBy: ActorIdentity;
  /** Usuario dono da caixa de e-mail (Gmail). Nao e usado para escolher numero de WhatsApp. */
  senderUserId: Uuid | null;
}

/**
 * Fonte do conteudo. Implementada pelo consumidor da outbox (PR seguinte): a
 * outbox nao guarda corpo de mensagem. Devolve null se o conteudo nao existe mais.
 */
export interface PayloadResolver {
  resolve(entry: DispatchEntry): Promise<DispatchPayload | null>;
}

/** Hash canonico do payload fixado no enqueue (sha256 hex). */
export function computePayloadHash(payload: Pick<DispatchPayload, 'body' | 'subject' | 'templateParams'>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        body: payload.body,
        subject: payload.subject ?? null,
        templateParams: payload.templateParams ?? [],
      }),
    )
    .digest('hex');
}

export type ProviderSendOutcome =
  | { kind: 'accepted'; externalId: string }
  /** O servico garante que NADA foi enviado (falha antes da chamada ou recusa definitiva). */
  | { kind: 'rejected'; reason: string }
  /** Pode ter saido. Vira `uncertain`. */
  | { kind: 'ambiguous'; reason: string };

export type ProviderLookupOutcome =
  | { kind: 'accepted'; externalId: string }
  /** O provedor confirma que nao houve aceitacao. Unico caso que permite retry. */
  | { kind: 'not_accepted' }
  | { kind: 'unknown' };

export interface ProviderSendRequest {
  orgId: Uuid;
  outboxId: Uuid;
  leadId: Uuid;
  /** Identidade normalizada: digitos (WhatsApp) ou e-mail. */
  to: string;
  payload: DispatchPayload;
  command: StoredSendCommand;
}

export interface ProviderAdapter {
  provider: MessageProvider;
  send(request: ProviderSendRequest): Promise<ProviderSendOutcome>;
  /** Consulta o provedor sobre uma entrada incerta. Ausente: nunca resolve sozinho. */
  lookup?(request: ProviderSendRequest): Promise<ProviderLookupOutcome>;
}

export type ProviderAdapters = Partial<Record<MessageProvider, ProviderAdapter>>;

// ---------------------------------------------------------------------------
// Revalidacao
// ---------------------------------------------------------------------------

export type RevalidationResult = { ok: true } | { ok: false; reason: string; retryable: boolean };

/**
 * Gateway de novo, imediatamente antes do envio (e antes de um retry). O
 * provedor e a instancia precisam coincidir com o comando original: divergencia
 * cancela, nunca troca de caminho.
 */
export async function revalidateEntry(
  entry: DispatchEntry,
  payload: DispatchPayload,
  now: Date,
): Promise<RevalidationResult> {
  if (payload.requestedBy.orgId !== entry.orgId) {
    return { ok: false, reason: 'actor_org_mismatch', retryable: false };
  }
  const request: SendGatewayRequest = {
    orgId: entry.orgId,
    leadId: entry.leadId,
    enrollmentId: null,
    stepId: null,
    channel: entry.channel,
    preferredProvider: entry.command.provider,
    requestedBy: payload.requestedBy,
    contact: entry.contact,
    senderInstanceId: entry.command.senderInstanceId,
    // A aprovacao do template foi verificada pelo gateway no enqueue.
    template: entry.command.templateId ? { id: entry.command.templateId, approved: true } : null,
  };
  const decision = await evaluateSend(request, now);
  if (!decision.allowed) {
    return { ok: false, reason: `gateway_denied:${decision.reasons.join(',')}`, retryable: decision.retryable };
  }
  if (
    decision.provider !== entry.command.provider ||
    (decision.senderInstanceId ?? null) !== (entry.command.senderInstanceId ?? null)
  ) {
    return { ok: false, reason: 'decision_diverged', retryable: false };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------

export async function readEntryContact(orgId: Uuid, outboxId: Uuid): Promise<string | null> {
  try {
    const { data, error } = (await from(createServiceRoleClient(), 'send_outbox')
      .select('contact_identity')
      .eq('org_id', orgId)
      .eq('id', outboxId)
      .limit(1)) as { data: Array<{ contact_identity: string }> | null; error?: { message: string } | null };
    if (error) return null;
    return data?.[0]?.contact_identity ?? null;
  } catch {
    return null;
  }
}

export function logDispatcher(event: string, fields: Record<string, string | number | boolean | null>): void {
  console.warn(JSON.stringify({ event, ...fields }));
}

type Timed<T> = { timedOut: false; value: T } | { timedOut: true };

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<Timed<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  promise.catch(() => undefined); // resultado tardio apos o timeout e descartado
  try {
    const result = await Promise.race([promise, timeout]);
    return result === 'timeout' ? { timedOut: true } : { timedOut: false, value: result };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Confirma com poucas repeticoes apenas para falha de escrita (CAS torna isso seguro). */
async function confirmWithRetry(
  input: Parameters<typeof confirmSend>[0],
  tries = 3,
): Promise<ActionResult<ConfirmSendResult>> {
  let last: ActionResult<ConfirmSendResult> = { success: false, error: 'nao tentou', code: 'write_failed' };
  for (let i = 0; i < tries; i++) {
    last = await confirmSend(input);
    if (last.success || last.code !== 'write_failed') return last;
  }
  return last;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface DispatchInput {
  orgId: Uuid;
  /** Identificador do worker que detem o lease. */
  leaseOwner: string;
  resolver: PayloadResolver;
  adapters: ProviderAdapters;
  maxItems?: number;
  leaseSeconds?: number;
  providerTimeoutMs?: number;
  now?: () => Date;
}

export type DispatchItemOutcome =
  | 'sent'
  | 'failed'
  | 'uncertain'
  | 'cancelled'
  | 'suppressed'
  /** Nada foi alterado; o lease vence e a entrada volta a ser candidata. */
  | 'deferred'
  /** O envio ocorreu mas o registro falhou; fica `sending` e vira `uncertain` pelo lease. */
  | 'confirm_failed';

export interface DispatchRunResult {
  enabled: boolean;
  /** Motivo de nao ter feito nada, quando aplicavel. */
  reason: string | null;
  claimed: number;
  sent: number;
  failed: number;
  uncertain: number;
  cancelled: number;
  suppressed: number;
  deferred: number;
  confirmFailed: number;
  /** Contadores do proprio claim_send (supressao e lease vencido em `sending`). */
  suppressedAtClaim: number;
  uncertainAtClaim: number;
}

const emptyResult = (enabled: boolean, reason: string | null): DispatchRunResult => ({
  enabled,
  reason,
  claimed: 0,
  sent: 0,
  failed: 0,
  uncertain: 0,
  cancelled: 0,
  suppressed: 0,
  deferred: 0,
  confirmFailed: 0,
  suppressedAtClaim: 0,
  uncertainAtClaim: 0,
});

type CounterKey = 'sent' | 'failed' | 'uncertain' | 'cancelled' | 'suppressed' | 'deferred' | 'confirmFailed';

const COUNTER: Record<DispatchItemOutcome, CounterKey> = {
  sent: 'sent',
  failed: 'failed',
  uncertain: 'uncertain',
  cancelled: 'cancelled',
  suppressed: 'suppressed',
  deferred: 'deferred',
  confirm_failed: 'confirmFailed',
};

export async function dispatchOnce(input: DispatchInput): Promise<DispatchRunResult> {
  if (!(await isDispatcherEnabled())) return emptyResult(false, 'flag_disabled');

  const result = emptyResult(true, null);
  const maxItems = Math.max(1, input.maxItems ?? DEFAULT_MAX_ITEMS);

  for (let i = 0; i < maxItems; i++) {
    // Reavalia a flag a cada item: desligar pausa o envio no meio da rodada.
    if (i > 0 && !(await isDispatcherEnabled())) {
      result.reason = 'flag_disabled_mid_run';
      break;
    }
    const claim = await claimSend({
      orgId: input.orgId,
      leaseOwner: input.leaseOwner,
      leaseSeconds: input.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
    });
    if (!claim.success) {
      result.reason = claim.code ?? 'claim_failed';
      break;
    }
    result.suppressedAtClaim += claim.data.suppressed;
    result.uncertainAtClaim += claim.data.uncertain;
    if (!claim.data.claimed) break;

    result.claimed += 1;
    let outcome: DispatchItemOutcome;
    try {
      outcome = await processClaimed(input, claim.data.claimed);
    } catch (err) {
      // Excecao inesperada ANTES da chamada ao provedor: nada foi enviado.
      // Depois dela, processClaimed ja trata tudo como incerto.
      console.error('[dispatcher] erro inesperado no item', claim.data.claimed.outboxId, err instanceof Error ? err.name : 'erro');
      outcome = 'deferred';
    }
    result[COUNTER[outcome]] += 1;
  }
  return result;
}

/** Telemetria de saude nunca interrompe o envio nem o registro do resultado. */
async function recordHealthOutcome(
  orgId: Uuid,
  health: Extract<DispatchHealthCheck, { enabled: true; allowed: true }>,
  outcome: ProviderSendOutcome,
  at: Date,
): Promise<void> {
  try {
    const left = outcome.kind !== 'rejected';
    await recordNumberHealthSignals({
      orgId,
      instanceId: health.instanceId,
      now: at,
      delta: {
        sentNewContacts: left && health.isNewContact ? 1 : 0,
        sentToRespondents: left && !health.isNewContact ? 1 : 0,
        failures: outcome.kind === 'rejected' ? 1 : 0,
      },
    });
  } catch {
    // ignorado de proposito
  }
}

async function processClaimed(input: DispatchInput, claimed: ClaimedSend): Promise<DispatchItemOutcome> {
  const now = input.now ?? (() => new Date());
  const { orgId, leaseOwner } = input;
  const { outboxId, command } = claimed;
  let version = claimed.version;

  const closeBeforeSend = async (target: 'cancelled' | 'failed', reason: string): Promise<DispatchItemOutcome> => {
    const res = await confirmWithRetry({ orgId, outboxId, expectedVersion: version, leaseOwner, target, error: reason });
    logDispatcher('dispatcher_closed', { orgId, outboxId, target, reason, ok: res.success });
    return res.success ? target : 'deferred';
  };

  // 1. Consistencia do comando -------------------------------------------------
  if (claimed.provider !== command.provider) return closeBeforeSend('cancelled', 'provider_mismatch');
  if (Date.parse(command.expiresAt) <= now().getTime() || Number.isNaN(Date.parse(command.expiresAt))) {
    return closeBeforeSend('cancelled', 'command_expired');
  }
  if (claimed.attempts > MAX_DISPATCH_ATTEMPTS) return closeBeforeSend('cancelled', 'max_attempts');

  const adapter = input.adapters[command.provider];
  if (!adapter) return closeBeforeSend('cancelled', 'adapter_missing');

  // 2. Conteudo e hash ---------------------------------------------------------
  const contact = await readEntryContact(orgId, outboxId);
  if (!contact) return 'deferred';
  const entry: DispatchEntry = {
    orgId,
    outboxId,
    leadId: claimed.leadId,
    channel: claimed.channel,
    provider: claimed.provider,
    command,
    contact,
    attempts: claimed.attempts,
  };
  const payload = await input.resolver.resolve(entry);
  if (!payload) return closeBeforeSend('failed', 'payload_unavailable');
  if (computePayloadHash(payload) !== String(command.payloadHash).toLowerCase()) {
    return closeBeforeSend('failed', 'payload_hash_mismatch');
  }

  // 3. Gateway de novo, imediatamente antes de enviar --------------------------
  const revalidation = await revalidateEntry(entry, payload, now());
  if (!revalidation.ok) {
    // Indisponibilidade transitoria de contexto: deixa o lease vencer e tenta depois.
    if (revalidation.retryable) return 'deferred';
    return closeBeforeSend('cancelled', revalidation.reason.slice(0, 120));
  }

  // 4. Flag de novo, depois transiciona para `sending` (revalida holds no banco)
  if (!(await isDispatcherEnabled())) return 'deferred';

  // 4a. Saude e tetos do numero (PR10), so Evolution. O gateway acabou de confirmar a continuidade.
  let health: DispatchHealthCheck = { enabled: false };
  if (command.provider === 'evolution') {
    health = await checkDispatchHealth({
      orgId,
      leadId: claimed.leadId,
      senderInstanceId: command.senderInstanceId,
      continuityConfirmedByGateway: true,
      now: now(),
    });
    if (health.enabled && !health.allowed) {
      logDispatcher('dispatcher_number_health_blocked', {
        orgId,
        outboxId,
        reasons: health.reasons.join(','),
        retryable: health.retryable,
      });
      // Capacidade esgotada ou leitura incerta: espera. Pausa ou revisao: cancela. Nunca outro numero.
      if (health.retryable) return 'deferred';
      return closeBeforeSend('cancelled', `number_health:${health.reasons.join(',')}`.slice(0, 120));
    }
  }

  const toSending = await confirmWithRetry({
    orgId,
    outboxId,
    expectedVersion: version,
    leaseOwner,
    target: 'sending' satisfies ConfirmTarget,
  });
  if (!toSending.success) {
    logDispatcher('dispatcher_sending_refused', { orgId, outboxId, code: toSending.code ?? null });
    return 'deferred';
  }
  if (toSending.data.outcome === 'suppressed') return 'suppressed';
  version = toSending.data.version;

  // 5. Chamada ao provedor: a partir daqui, qualquer duvida e `uncertain` --------
  let sendOutcome: ProviderSendOutcome;
  const timeoutMs = input.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  try {
    const timed = await withTimeout(
      adapter.send({ orgId, outboxId, leadId: claimed.leadId, to: contact, payload, command }),
      timeoutMs,
    );
    sendOutcome = timed.timedOut ? { kind: 'ambiguous', reason: 'provider_timeout' } : timed.value;
  } catch {
    sendOutcome = { kind: 'ambiguous', reason: 'provider_exception' };
  }

  // 5a. Soma na janela de saude: aceito ou incerto pode ter saido; rejeitado nao saiu (falha).
  if (health.enabled && health.allowed) {
    await recordHealthOutcome(orgId, health, sendOutcome, now());
  }

  // 6. Registro do resultado -----------------------------------------------------
  const finalTarget: { target: ConfirmTarget; outcome: DispatchItemOutcome; externalId?: string; error?: string } =
    sendOutcome.kind === 'accepted' && sendOutcome.externalId.trim()
      ? { target: 'sent', outcome: 'sent', externalId: sendOutcome.externalId.trim() }
      : sendOutcome.kind === 'rejected'
        ? { target: 'failed', outcome: 'failed', error: sendOutcome.reason }
        : {
            target: 'uncertain',
            outcome: 'uncertain',
            error: sendOutcome.kind === 'ambiguous' ? sendOutcome.reason : 'accepted_without_external_id',
          };

  const res = await confirmWithRetry({
    orgId,
    outboxId,
    expectedVersion: version,
    leaseOwner,
    target: finalTarget.target,
    externalId: finalTarget.externalId,
    error: finalTarget.error,
  });
  if (!res.success) {
    // Pode ter saido e nao ficou registrado. A linha segue `sending`; o lease vencido
    // a transforma em `uncertain` e a reconciliacao resolve. O id do provedor (nao e
    // segredo) vai para o log para permitir a conciliacao manual.
    console.error(
      '[dispatcher] confirmacao falhou apos a chamada ao provedor',
      JSON.stringify({
        orgId,
        outboxId,
        attempted: finalTarget.target,
        code: res.code ?? null,
        externalId: finalTarget.externalId ?? null,
      }),
    );
    return 'confirm_failed';
  }
  logDispatcher('dispatcher_result', { orgId, outboxId, provider: command.provider, status: res.data.status });
  return finalTarget.outcome;
}
