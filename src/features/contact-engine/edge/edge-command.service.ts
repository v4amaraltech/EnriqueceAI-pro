import { createHash } from 'node:crypto';

import type { ActionResult } from '@/lib/actions/action-result';
import { phoneDigits, isQueryablePhone } from '@/features/contact-holds/services/hold-flags';

import type { SendDecision, SendDenialReason, Uuid } from '../types';
import { isScopedFlagEnabled } from '../services/flag-scope.service';
import type { ContactAccess } from '../services/ownership.service';
import type { SendGatewayRequest } from '../services/send-decision.service';

import {
  EDGE_CONTRACT_VERSION,
  type AuthorizeRequest,
  type EdgeWorkflow,
  type EmailSendRequest,
  type ReplyRouteRequest,
  type ResultRequest,
} from './edge-command.schemas';

/**
 * Adaptadores de borda do n8n (PR13): o n8n PEDE a decisao e REGISTRA o resultado;
 * quem decide e o app (gateway, holds, ownership).
 *
 * Flag `edge_command_adapter` (app_flags, escopo por organizacao via flag-scope,
 * nasce desligada). Desligada: nenhuma leitura de dado, nenhuma escrita, e as rotas
 * antigas `/api/v1/bdr/*` seguem sem qualquer alteracao.
 *
 * Regras:
 *  - O destinatario e sempre derivado no servidor (lead da organizacao da chave).
 *    O n8n nunca informa telefone, e-mail, numero ou provedor.
 *  - Gateway negando bloqueia. Falha de leitura ou de auditoria nega (fail-closed).
 *  - Idempotencia por `idempotency_key` do chamador, escopada por organizacao e operacao,
 *    gravada em `decision_events` (indice unico existente, sem migration).
 *    Replay de decisao negada devolve a negacao gravada, nunca vira permissao.
 *  - Nao enfileira na `send_outbox`: o dispatcher reservaria a entrada e haveria dois
 *    emissores da mesma etapa. Ver docs/architecture/n8n-edge-adapters.md.
 *  - Nada de PII em log ou em evento: so ids, codigos e motivos.
 */
export const EDGE_COMMAND_FLAG_KEY = 'edge_command_adapter';
export const EDGE_MODEL_VERSION = 'edge_command_v1';

export type NextAction = 'send' | 'release' | 'skip' | 'none';
export interface EdgeResponse {
  status: number;
  body: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Portas (injetaveis em teste)
// ---------------------------------------------------------------------------

export interface EdgeAuth {
  orgId: Uuid;
  keyId: Uuid | null;
}

export interface Target {
  leadId: Uuid;
  enrollmentId: Uuid | null;
  stepId: Uuid | null;
  executionId: Uuid | null;
  contact: string;
  assignedTo: Uuid | null;
}

export type TargetResult =
  | { ok: true; target: Target }
  | { ok: false; reason: 'not_found' | 'wrong_channel' | 'already_confirmed' | 'error' };

export interface StoredEvent {
  disposition: string;
  reasons: string[];
}

export type DelegateKind = 'whatsapp_registrar' | 'whatsapp_resposta' | 'email_send';

export interface EdgePorts {
  isEnabled(orgId: Uuid): Promise<boolean>;
  resolveTarget(orgId: Uuid, ref: { workflow: EdgeWorkflow; executionId?: string; leadId?: string }): Promise<TargetResult>;
  evaluate(request: SendGatewayRequest): Promise<SendDecision>;
  readEvent(orgId: Uuid, key: string): Promise<StoredEvent | null | 'error'>;
  recordEvent(input: {
    orgId: Uuid;
    leadId: Uuid;
    key: string;
    disposition: string;
    workflow: string;
    reasons?: string[];
  }): Promise<'recorded' | 'duplicate' | 'error'>;
  skipStep(input: { orgId: Uuid; executionId: Uuid; workflow: EdgeWorkflow; performedBy: Uuid | null; motivo: string }): Promise<boolean>;
  /** Chama o handler legado correspondente, sem altera-lo. */
  delegate(kind: DelegateKind, body: Record<string, unknown>): Promise<{ status: number; body: unknown }>;
  findLeadsByPhone(orgId: Uuid, digits: string): Promise<Uuid[] | null>;
  access(input: { orgId: Uuid; leadId: Uuid; contact: string }): Promise<ActionResult<ContactAccess>>;
}

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------

type Op = 'authorize' | 'result' | 'reply';

/** Chave gravada: escopada por org e operacao; hash evita vazar o valor e respeita o limite de 200. */
export function edgeEventKey(orgId: Uuid, op: Op, clientKey: string): string {
  const digest = createHash('sha256').update(`${orgId}|${op}|${clientKey}`).digest('hex');
  return `edge.v1.${op}.${digest}`;
}

export async function isEdgeAdapterEnabled(orgId: Uuid): Promise<boolean> {
  return isScopedFlagEnabled(EDGE_COMMAND_FLAG_KEY, { orgId });
}

const respond = (status: number, body: Record<string, unknown>): EdgeResponse => ({
  status,
  body: { contract_version: EDGE_CONTRACT_VERSION, ...body },
});
const failure = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  respond(status, { success: false, code, error, ...extra });

const disabled = () => failure(403, 'adapter_disabled', 'Adaptador de borda desativado para esta organização');
const unavailable = () => failure(503, 'unavailable', 'Contexto indisponível. Tente novamente; nada foi enviado.', { retryable: true });

function targetFailure(reason: Extract<TargetResult, { ok: false }>['reason']): EdgeResponse {
  switch (reason) {
    case 'not_found':
      return failure(404, 'not_found', 'Passo ou lead não encontrado nesta organização');
    case 'wrong_channel':
      return failure(400, 'wrong_channel', 'O passo não pertence ao canal deste workflow');
    case 'already_confirmed':
      return respond(200, { success: true, data: { allowed: false, next_action: 'none' satisfies NextAction, estado: 'ja_confirmado' } });
    default:
      return unavailable();
  }
}

function nextActionFor(decision: SendDecision): NextAction {
  if (decision.allowed) return 'send';
  return decision.retryable ? 'release' : 'skip';
}

function buildGatewayRequest(
  auth: EdgeAuth,
  workflow: EdgeWorkflow,
  target: Target,
  template: AuthorizeRequest['template'],
): SendGatewayRequest {
  return {
    orgId: auth.orgId,
    leadId: target.leadId,
    enrollmentId: target.enrollmentId,
    stepId: target.stepId,
    channel: workflow === 'ana_whatsapp' ? 'whatsapp' : 'email',
    // Provedor: o gateway decide. O n8n nao escolhe e nunca ha fallback.
    preferredProvider: null,
    requestedBy: { orgId: auth.orgId, userId: target.assignedTo, source: 'n8n', apiKeyId: auth.keyId },
    contact: target.contact,
    template: template ? { id: template.id, approved: true } : null,
  };
}

// ---------------------------------------------------------------------------
// 1. authorize
// ---------------------------------------------------------------------------

export async function authorizeSend(auth: EdgeAuth, req: AuthorizeRequest, ports: EdgePorts): Promise<EdgeResponse> {
  if (!(await ports.isEnabled(auth.orgId))) return disabled();

  const resolved = await ports.resolveTarget(auth.orgId, { workflow: req.workflow, executionId: req.execution_id, leadId: req.lead_id });
  if (!resolved.ok) return targetFailure(resolved.reason);
  const { target } = resolved;

  const key = edgeEventKey(auth.orgId, 'authorize', req.idempotency_key);
  const previous = await ports.readEvent(auth.orgId, key);
  if (previous === 'error') return unavailable();

  const deniedBody = (reasons: string[], replay: boolean, retryable: boolean) =>
    respond(200, {
      success: true,
      data: {
        idempotency_key: req.idempotency_key,
        replay,
        allowed: false,
        next_action: (retryable ? 'release' : 'skip') satisfies NextAction,
        retryable,
        reasons,
        lead_id: target.leadId,
      },
    });

  // Replay de negacao: devolve a negacao gravada, sem reavaliar. Nunca vira permissao.
  if (previous && previous.disposition === 'denied') {
    return deniedBody(previous.reasons, true, previous.reasons.length > 0 && previous.reasons.every(isRetryableReason));
  }

  // Replay de permissao: reavalia ao vivo (so pode ficar mais restrito).
  const decision = await ports.evaluate(buildGatewayRequest(auth, req.workflow, target, req.template));

  if (!previous) {
    const stored = await ports.recordEvent({
      orgId: auth.orgId,
      leadId: target.leadId,
      key,
      disposition: decision.allowed ? 'allowed' : 'denied',
      workflow: req.workflow,
      reasons: decision.allowed ? [] : decision.reasons,
    });
    // Sem trilha gravada nao ha autorizacao: o resultado depende dela.
    if (stored === 'error') return unavailable();
    if (stored === 'duplicate') {
      // Corrida: outra chamada gravou primeiro. A gravada prevalece quando e negacao.
      const winner = await ports.readEvent(auth.orgId, key);
      if (winner === 'error') return unavailable();
      if (winner?.disposition === 'denied') {
        return deniedBody(winner.reasons, true, winner.reasons.length > 0 && winner.reasons.every(isRetryableReason));
      }
    }
  }

  const replay = Boolean(previous);
  if (!decision.allowed) return deniedBody(decision.reasons, replay, decision.retryable);

  return respond(200, {
    success: true,
    data: {
      idempotency_key: req.idempotency_key,
      replay,
      allowed: true,
      next_action: 'send' satisfies NextAction,
      provider: decision.provider,
      requires_template: decision.requiresTemplate,
      template_id: decision.templateId,
      // Destinatario escolhido pelo app (apenas WhatsApp; o e-mail da cadencia sai pelo app).
      ...(req.workflow === 'ana_whatsapp' ? { to: target.contact } : {}),
      lead_id: target.leadId,
    },
  });
}

const RETRYABLE: readonly SendDenialReason[] = ['context_unavailable', 'sender_health_unknown', 'daily_cap_reached'];
function isRetryableReason(reason: string): boolean {
  return (RETRYABLE as readonly string[]).includes(reason);
}

// ---------------------------------------------------------------------------
// 2. result (WhatsApp, agente de e-mail e "nao enviado" da cadencia de e-mail)
// ---------------------------------------------------------------------------

export async function registerResult(auth: EdgeAuth, req: ResultRequest, ports: EdgePorts): Promise<EdgeResponse> {
  if (!(await ports.isEnabled(auth.orgId))) return disabled();

  const resolved = await ports.resolveTarget(auth.orgId, { workflow: req.workflow, executionId: req.execution_id, leadId: req.lead_id });
  // Passo ja confirmado e um replay legitimo do resultado; segue para a leitura do evento.
  if (!resolved.ok && resolved.reason !== 'already_confirmed') return targetFailure(resolved.reason);

  const resultKey = edgeEventKey(auth.orgId, 'result', req.idempotency_key);
  const recorded = await ports.readEvent(auth.orgId, resultKey);
  if (recorded === 'error') return unavailable();
  if (recorded) {
    return respond(200, { success: true, data: { idempotency_key: req.idempotency_key, replay: true, status: recorded.disposition } });
  }
  if (!resolved.ok) return targetFailure(resolved.reason);
  const { target } = resolved;

  const authorization = await ports.readEvent(auth.orgId, edgeEventKey(auth.orgId, 'authorize', req.idempotency_key));
  if (authorization === 'error') return unavailable();
  if (!authorization) return failure(409, 'not_authorized', 'Nenhuma autorização para esta idempotency_key');
  if (authorization.disposition !== 'allowed' && req.status !== 'nao_enviado') {
    return failure(409, 'authorization_denied', 'O gateway negou este envio; só é possível registrar nao_enviado');
  }

  let passthrough: Record<string, unknown> = {};
  if (req.workflow === 'ana_whatsapp') {
    if (req.status === 'nao_enviado') {
      const ok = await ports.skipStep({
        orgId: auth.orgId, executionId: target.executionId as Uuid, workflow: req.workflow,
        performedBy: target.assignedTo, motivo: authorization.reasons[0] ?? 'nao_enviado',
      });
      if (!ok) return unavailable();
    } else {
      const res = await ports.delegate('whatsapp_registrar', {
        acao: 'registrar', execution_id: target.executionId, status: req.status,
        texto: req.texto, message_id: req.message_id, erro: req.erro,
      });
      if (res.status < 200 || res.status >= 300) return legacyFailure(res);
      passthrough = { registro: pickData(res.body) };
    }
  } else if (req.workflow === 'ana_email') {
    const ok = await ports.skipStep({
      orgId: auth.orgId, executionId: target.executionId as Uuid, workflow: req.workflow,
      performedBy: target.assignedTo, motivo: authorization.reasons[0] ?? 'nao_enviado',
    });
    if (!ok) return unavailable();
  }
  // ana_email_agent: so a trilha; o fluxo atual do agente segue gravando o proprio historico.

  const stored = await ports.recordEvent({
    orgId: auth.orgId, leadId: target.leadId, key: resultKey, disposition: req.status, workflow: req.workflow,
  });
  if (stored === 'error') return unavailable();
  return respond(200, { success: true, data: { idempotency_key: req.idempotency_key, replay: false, status: req.status, ...passthrough } });
}

function pickData(body: unknown): unknown {
  return body && typeof body === 'object' && 'data' in body ? (body as { data: unknown }).data : null;
}

function legacyFailure(res: { status: number; body: unknown }): EdgeResponse {
  const b = (res.body && typeof res.body === 'object' ? res.body : {}) as Record<string, unknown>;
  return failure(res.status, typeof b.code === 'string' ? b.code : 'legacy_error', typeof b.error === 'string' ? b.error : 'Falha ao registrar', {
    data: b.data ?? null,
  });
}

// ---------------------------------------------------------------------------
// 3. email-send (a cadencia de e-mail envia pelo app; revalida o gateway antes)
// ---------------------------------------------------------------------------

export async function sendCadenceEmail(auth: EdgeAuth, req: EmailSendRequest, ports: EdgePorts): Promise<EdgeResponse> {
  if (!(await ports.isEnabled(auth.orgId))) return disabled();

  const resolved = await ports.resolveTarget(auth.orgId, { workflow: 'ana_email', executionId: req.execution_id });
  if (!resolved.ok) return targetFailure(resolved.reason);
  const { target } = resolved;

  // Replay do resultado: nunca reenvia.
  const resultKey = edgeEventKey(auth.orgId, 'result', req.idempotency_key);
  const recorded = await ports.readEvent(auth.orgId, resultKey);
  if (recorded === 'error') return unavailable();
  if (recorded) {
    return respond(200, { success: true, data: { idempotency_key: req.idempotency_key, replay: true, status: recorded.disposition } });
  }

  const authorization = await ports.readEvent(auth.orgId, edgeEventKey(auth.orgId, 'authorize', req.idempotency_key));
  if (authorization === 'error') return unavailable();
  if (!authorization) return failure(409, 'not_authorized', 'Nenhuma autorização para esta idempotency_key');
  if (authorization.disposition !== 'allowed') return failure(409, 'authorization_denied', 'O gateway negou este envio');

  // Revalidacao imediatamente antes do envio: holds e opt-out novos prevalecem.
  const decision = await ports.evaluate(buildGatewayRequest(auth, 'ana_email', target, undefined));
  if (!decision.allowed) {
    return failure(409, 'gateway_denied', 'O gateway negou o envio na revalidação', {
      reasons: decision.reasons, next_action: nextActionFor(decision), retryable: decision.retryable,
    });
  }

  const res = await ports.delegate('email_send', {
    execution_id: req.execution_id, remetente_email: req.remetente_email, assunto: req.assunto, corpo: req.corpo,
  });
  const body = (res.body && typeof res.body === 'object' ? res.body : {}) as Record<string, unknown>;
  const code = typeof body.code === 'string' ? body.code : null;
  const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;

  let status: string | null = null;
  // `ja_confirmado`: o passo ja estava fechado; o desfecho original nao e conhecido aqui, entao nada a gravar.
  if (res.status >= 200 && res.status < 300) status = data.estado === 'ja_confirmado' ? null : 'enviado';
  else if (code === 'envio_incerto') status = 'incerto';
  else if (code === 'envio_falhou') status = 'falhou';
  else if (code === 'bloqueado') status = 'nao_enviado';
  // caixa_indisponivel, teto_caixa e demais: nada saiu e o passo volta; nao ha estado terminal a gravar.

  if (status) {
    const stored = await ports.recordEvent({
      orgId: auth.orgId, leadId: target.leadId, key: resultKey, disposition: status, workflow: 'ana_email',
    });
    if (stored === 'error') console.error('[edge-command] result_event_write_failed', { orgId: auth.orgId, leadId: target.leadId });
  }
  if (res.status >= 200 && res.status < 300) {
    return respond(200, { success: true, data: { idempotency_key: req.idempotency_key, replay: false, status: status ?? 'ja_confirmado', envio: data } });
  }
  return legacyFailure(res);
}

// ---------------------------------------------------------------------------
// 4. replies/route (roteador de respostas)
// ---------------------------------------------------------------------------

export type ReplyRoute = 'ai' | 'human' | 'none' | 'unknown';

/** Decisao pura: quem responde depois que a resposta foi registrada. */
export function decideReplyRoute(access: ActionResult<ContactAccess>): { route: ReplyRoute; ownerUserId: Uuid | null } {
  // Sem leitura ou sem ownership ligado nao ha IA respondendo: um humano decide.
  if (!access.success) return { route: 'human', ownerUserId: null };
  const a = access.data;
  if (a.reasons.includes('flag_disabled')) return { route: 'human', ownerUserId: null };
  if (a.holds.bloqueado_total || a.lastConsent === 'opt_out') return { route: 'none', ownerUserId: null };
  const ownerUserId = a.owner?.ownerUserId ?? null;
  if (a.holds.bloqueado_conversa) return { route: 'human', ownerUserId };
  if (a.owner && a.owner.automationMode !== 'automatic') return { route: 'human', ownerUserId };
  return { route: 'ai', ownerUserId };
}

export async function routeInboundReply(auth: EdgeAuth, req: ReplyRouteRequest, ports: EdgePorts): Promise<EdgeResponse> {
  if (!(await ports.isEnabled(auth.orgId))) return disabled();

  const digits = phoneDigits(req.phone);
  if (!isQueryablePhone(digits)) return failure(400, 'invalid_phone', 'Telefone inválido');

  const leadIds = await ports.findLeadsByPhone(auth.orgId, digits);
  if (leadIds === null) return unavailable();
  if (leadIds.length === 0) {
    return respond(200, { success: true, data: { idempotency_key: req.idempotency_key, replay: false, route: 'unknown' satisfies ReplyRoute, lead_id: null } });
  }

  const key = edgeEventKey(auth.orgId, 'reply', req.idempotency_key);
  const previous = await ports.readEvent(auth.orgId, key);
  if (previous === 'error') return unavailable();
  const replay = Boolean(previous);

  // Telefone ambiguo: sem associar a resposta a um lead. So o pedido de parar vale para todos.
  const ambiguous = leadIds.length > 1;
  const optOutOnly = ambiguous && req.opt_out !== true;

  if (!replay && !optOutOnly) {
    for (const leadId of leadIds) {
      const res = await ports.delegate('whatsapp_resposta', {
        acao: 'resposta', lead_id: leadId, texto: req.texto, message_id: req.message_id, opt_out: req.opt_out === true,
      });
      if (res.status < 200 || res.status >= 300) return legacyFailure(res);
    }
    const first = leadIds[0] as Uuid;
    const stored = await ports.recordEvent({
      orgId: auth.orgId, leadId: first, key, disposition: req.opt_out ? 'opt_out' : 'replied', workflow: 'reply_router',
    });
    if (stored === 'error') console.error('[edge-command] reply_event_write_failed', { orgId: auth.orgId, leadId: first });
  }

  if (ambiguous) {
    return respond(200, { success: true, data: { idempotency_key: req.idempotency_key, replay, route: 'human' satisfies ReplyRoute, lead_id: null, ambiguous: true } });
  }

  const leadId = leadIds[0] as Uuid;
  const access = await ports.access({ orgId: auth.orgId, leadId, contact: req.phone });
  const { route, ownerUserId } = decideReplyRoute(access);
  return respond(200, {
    success: true,
    data: { idempotency_key: req.idempotency_key, replay, route, lead_id: leadId, owner_user_id: ownerUserId },
  });
}
