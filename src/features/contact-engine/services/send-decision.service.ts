import { resolveHoldFlags, type HoldFlags } from '@/features/contact-holds/services/hold-flags';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type {
  GatewayMode,
  IsoTimestamp,
  MessageProvider,
  SendDecision,
  SendDenialReason,
  SendIntent,
  Uuid,
} from '../types';

import {
  checkNumberCanSend,
  loadHealthFactsForGateway,
  type NumberHealthFacts,
} from './number-health.service';
import { getContactAccess, normalizeContactIdentity, type ConsentKind } from './ownership.service';

/**
 * Gateway de decisao de envio (PR06).
 *
 * NUNCA envia nada: apenas devolve um contrato de comando autorizado
 * (`SendDecision` com `allowed: true`) ou uma negacao com motivos. Nao ha
 * outbox, fila nem chamada a provedor aqui (outbox e o PR07).
 *
 * Camadas:
 *  - `decideSend` (pura): fatos entram, decisao sai. Qualquer fato ausente
 *    (`null`) ou invalido nega (fail-closed).
 *  - `loadSendFacts`: carrega ownership, holds, consentimento, conversa e estado
 *    da instancia. Erro de leitura vira fato `null`.
 *  - `evaluateSend`: carrega e decide. `runSendGatewayShadow`: so compara e registra.
 *
 * Flags `send_gateway_shadow` e `send_gateway_enforced` (app_flags, globais,
 * desligadas). `enforced` NAO esta integrado a nenhum caminho de envio.
 *
 * Politica: nunca sugerir troca de numero, de provedor ou rotacao. Uma negacao
 * nao carrega alternativa.
 */

export const SEND_GATEWAY_SHADOW_FLAG_KEY = 'send_gateway_shadow';
export const SEND_GATEWAY_ENFORCED_FLAG_KEY = 'send_gateway_enforced';

/** Janela de atendimento da Cloud API apos a ultima mensagem do lead. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Origens de consentimento que comprovam pedido do lead para ser contatado. */
export const CONTACT_REQUEST_SOURCES: readonly string[] = [
  'user_requested_contact',
  'lead_requested_contact',
  'authorized_on_call',
];

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------

export interface SendGatewayRequest extends SendIntent {
  /** Telefone ou e-mail bruto do destinatario. */
  contact: string;
  /** Instancia Evolution escolhida pelo chamador (necessaria para `evolution`). */
  senderInstanceId?: Uuid | null;
  /** Template oficial candidato, se o chamador tiver um. */
  template?: { id: string; approved: boolean } | null;
}

export interface AccessFacts {
  holds: HoldFlags;
  lastConsent: ConsentKind | null;
  /** Razoes de bloqueio ja calculadas pelo servico de ownership (ex.: flag_disabled). */
  blockedReasons: string[];
  owner: { userId: Uuid | null; version: number; automationMode: 'automatic' | 'human' | 'paused' } | null;
}

export interface ConversationFacts {
  /** Ultima resposta do lead neste canal, ou null se nunca respondeu. */
  lastInboundAt: IsoTimestamp | null;
  leadRequestedContact: boolean;
  leadReplied: boolean;
}

export interface InstanceFacts {
  id: Uuid;
  connected: boolean;
  paused: boolean;
}

/** Fatos de entrada da funcao pura. `null` significa leitura incerta ou com erro. */
export interface SendDecisionFacts {
  request: SendGatewayRequest;
  contactValid: boolean;
  access: AccessFacts | null;
  conversation: ConversationFacts | null;
  instance: InstanceFacts | null;
  /**
   * Saude e tetos do numero Evolution (PR10, flag `number_health_v1`).
   * `undefined` = flag desligada ou provedor sem numero proprio: nenhum efeito.
   * `null` = flag ligada mas leitura incerta: nega (fail-closed).
   */
  health?: NumberHealthFacts | null;
  now: Date;
}

// ---------------------------------------------------------------------------
// Decisao pura
// ---------------------------------------------------------------------------

function deny(reasons: SendDenialReason[], now: Date): SendDecision {
  const unique = [...new Set(reasons)];
  return {
    allowed: false,
    reasons: unique,
    retryable:
      unique.length > 0 &&
      unique.every((r) => r === 'context_unavailable' || r === 'sender_health_unknown' || r === 'daily_cap_reached'),
    decidedAt: now.toISOString(),
  };
}

export function decideSend(facts: SendDecisionFacts): SendDecision {
  const { request, access, conversation, instance, now } = facts;
  const reasons: SendDenialReason[] = [];

  if (request.channel !== 'whatsapp' && request.channel !== 'email') reasons.push('channel_not_allowed');
  if (!facts.contactValid) reasons.push('invalid_phone');

  // Acesso: holds, opt-out, flag e dono. Sem leitura, nega.
  if (!access) {
    reasons.push('context_unavailable');
  } else {
    if (access.blockedReasons.includes('flag_disabled')) reasons.push('flag_disabled');
    if (access.holds.bloqueado_total) reasons.push('hold_total');
    else {
      if (access.holds.bloqueado_prospeccao) reasons.push('hold_prospeccao');
      if (access.holds.bloqueado_conversa) reasons.push('hold_conversa');
    }
    if (access.lastConsent === 'opt_out' || access.blockedReasons.includes('consent_opted_out')) {
      reasons.push('consent_opted_out');
    }
    if (access.owner) {
      if (access.owner.userId && request.requestedBy.userId !== access.owner.userId) {
        reasons.push('owner_mismatch');
      }
      if (access.owner.automationMode !== 'automatic' && request.requestedBy.source !== 'app') {
        reasons.push('recent_reply_requires_human');
      }
    }
  }

  if (request.channel === 'email') {
    if (reasons.length > 0) return deny(reasons, now);
    return allow(request, 'gmail', null, false, null, access, now);
  }

  if (request.channel !== 'whatsapp') return deny(reasons, now);

  // WhatsApp ---------------------------------------------------------------
  // Provedor: oficial por padrao; Evolution so se pedido explicitamente e nunca
  // como fallback do oficial.
  const provider: MessageProvider = request.preferredProvider === 'evolution' ? 'evolution' : 'meta_cloud';
  if (request.preferredProvider === 'gmail') reasons.push('channel_not_allowed');

  if (!conversation) {
    reasons.push('context_unavailable');
  }
  if (!instance) {
    reasons.push('sender_health_unknown');
  } else if (instance.paused || !instance.connected) {
    reasons.push('sender_paused');
  }

  let requiresTemplate = false;
  let templateId: string | null = null;
  // Sem conversa ou acesso o motivo ja e `context_unavailable`; nao somar outro.
  let continuityOk = true;

  if (conversation && access) {
    if (provider === 'evolution') {
      const continuity = conversation.leadRequestedContact && conversation.leadReplied;
      if (!continuity || access.lastConsent !== 'opt_in') {
        continuityOk = false;
        reasons.push('evolution_requires_authorized_continuity');
      }
    } else {
      const inbound = conversation.lastInboundAt ? Date.parse(conversation.lastInboundAt) : null;
      if (inbound !== null && (Number.isNaN(inbound) || inbound > now.getTime())) {
        reasons.push('context_unavailable');
      } else {
        const firstContact = inbound === null;
        const windowOpen = inbound !== null && now.getTime() - inbound <= SERVICE_WINDOW_MS;
        if (firstContact && access.lastConsent !== 'opt_in') reasons.push('no_consent');
        if (!windowOpen) {
          requiresTemplate = true;
          if (request.template?.approved === true && request.template.id) {
            templateId = request.template.id;
          } else {
            reasons.push('outside_service_window_requires_template');
          }
        }
      }
    }
  }

  // Saude e tetos do numero (PR10). So com a flag ligada (`health !== undefined`).
  if (provider === 'evolution' && facts.health !== undefined) {
    const check = checkNumberCanSend(facts.health, {
      isNewContact: conversation ? !conversation.leadReplied : true,
      continuityAuthorized: continuityOk,
    });
    if (!check.allowed) reasons.push(...check.reasons);
  }

  if (reasons.length > 0 || !instance) return deny(reasons, now);
  return allow(request, provider, instance.id, requiresTemplate, templateId, access, now);
}

function allow(
  request: SendGatewayRequest,
  provider: MessageProvider,
  senderInstanceId: Uuid | null,
  requiresTemplate: boolean,
  templateId: string | null,
  access: AccessFacts | null,
  now: Date,
): SendDecision {
  void request;
  return {
    allowed: true,
    provider,
    senderInstanceId,
    requiresTemplate,
    templateId,
    ownershipVersion: access?.owner?.version ?? 0,
    consentEvidenceId: null,
    decidedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

type FlagRead = boolean | 'error';

async function readFlag(key: string): Promise<FlagRead> {
  try {
    const { data, error } = (await from(createServiceRoleClient(), 'app_flags')
      .select('enabled')
      .eq('key', key)
      .limit(1)) as { data: Array<{ enabled: boolean }> | null; error?: { message: string } | null };
    if (error) return 'error';
    return data?.[0]?.enabled === true;
  } catch {
    return 'error';
  }
}

/**
 * Modo do gateway. `enforced` e flag de restricao: erro de leitura conta como
 * ligada (fail-closed). `shadow` com erro de leitura conta como desligada.
 * Linha ausente vale desligada.
 */
export async function getGatewayMode(): Promise<GatewayMode> {
  const [enforced, shadow] = await Promise.all([
    readFlag(SEND_GATEWAY_ENFORCED_FLAG_KEY),
    readFlag(SEND_GATEWAY_SHADOW_FLAG_KEY),
  ]);
  if (enforced === true || enforced === 'error') return 'enforced';
  if (shadow === true) return 'shadow';
  return 'off';
}

// ---------------------------------------------------------------------------
// Carga de contexto
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof createServiceRoleClient>;
type Rows<T> = { data: T[] | null; error: { message: string } | null };

async function loadAccess(request: SendGatewayRequest): Promise<AccessFacts | null> {
  const res = await getContactAccess({
    orgId: request.orgId,
    leadId: request.leadId,
    contact: request.contact,
    channel: request.channel,
  });
  if (!res.success) return null;
  const a = res.data;
  return {
    holds: a.holds,
    lastConsent: a.lastConsent,
    blockedReasons: a.reasons,
    owner: a.owner
      ? { userId: a.owner.ownerUserId, version: a.owner.version, automationMode: a.owner.automationMode }
      : null,
  };
}

/** Combina duas leituras: bloqueio em qualquer uma prevalece (opt-out simultaneo). */
export function mergeAccess(first: AccessFacts | null, second: AccessFacts | null): AccessFacts | null {
  if (!first || !second) return null;
  const holds = resolveHoldFlags([
    ...(first.holds.bloqueado_total || second.holds.bloqueado_total ? [{ lead_id: '', tipo: 'total' }] : []),
    ...(first.holds.bloqueado_prospeccao || second.holds.bloqueado_prospeccao ? [{ lead_id: '', tipo: 'prospeccao' }] : []),
    ...(first.holds.bloqueado_conversa || second.holds.bloqueado_conversa ? [{ lead_id: '', tipo: 'conversa' }] : []),
  ]);
  const optedOut = first.lastConsent === 'opt_out' || second.lastConsent === 'opt_out';
  return {
    holds,
    lastConsent: optedOut ? 'opt_out' : second.lastConsent,
    blockedReasons: [...new Set([...first.blockedReasons, ...second.blockedReasons])],
    owner: second.owner,
  };
}

async function loadConversation(db: Db, request: SendGatewayRequest, identity: string): Promise<ConversationFacts | null> {
  const [replies, requests] = await Promise.all([
    from(db, 'interactions')
      .select('created_at')
      .eq('org_id', request.orgId)
      .eq('lead_id', request.leadId)
      .eq('channel', 'whatsapp')
      .eq('type', 'replied')
      .order('created_at', { ascending: false })
      .limit(1) as unknown as Promise<Rows<{ created_at: string }>>,
    from(db, 'contact_consent_evidence')
      .select('source')
      .eq('org_id', request.orgId)
      .eq('contact_identity', identity)
      .eq('channel', 'whatsapp')
      .eq('kind', 'opt_in')
      .limit(50) as unknown as Promise<Rows<{ source: string }>>,
  ]);
  if (replies.error || requests.error || !replies.data || !requests.data) return null;
  const lastInboundAt = replies.data[0]?.created_at ?? null;
  return {
    lastInboundAt,
    leadReplied: lastInboundAt !== null,
    leadRequestedContact: requests.data.some((r) => CONTACT_REQUEST_SOURCES.includes(r.source)),
  };
}

async function loadInstance(db: Db, request: SendGatewayRequest): Promise<InstanceFacts | null> {
  if (request.preferredProvider === 'evolution') {
    if (!request.senderInstanceId) return null;
    const res = (await from(db, 'whatsapp_instances')
      .select('id, status, auto_send_paused_at')
      .eq('org_id', request.orgId)
      .eq('id', request.senderInstanceId)
      .limit(1)) as unknown as Rows<{ id: string; status: string; auto_send_paused_at: string | null }>;
    const row = res.data?.[0];
    if (res.error || !row) return null;
    return { id: row.id, connected: row.status === 'connected', paused: row.auto_send_paused_at !== null };
  }
  const res = (await from(db, 'whatsapp_connections')
    .select('id, status')
    .eq('org_id', request.orgId)
    .limit(1)) as unknown as Rows<{ id: string; status: string }>;
  const row = res.data?.[0];
  if (res.error || !row) return null;
  return { id: row.id, connected: row.status === 'connected', paused: false };
}

export async function loadSendFacts(request: SendGatewayRequest, now: Date = new Date()): Promise<SendDecisionFacts> {
  const identity = normalizeContactIdentity(request.channel, request.contact);
  const base: SendDecisionFacts = {
    request,
    contactValid: identity !== null,
    access: null,
    conversation: null,
    instance: null,
    now,
  };
  if (identity === null) return base;

  try {
    const db = createServiceRoleClient();
    const first = await loadAccess(request);
    const wantsHealth = request.channel === 'whatsapp' && request.preferredProvider === 'evolution';
    const [conversation, instance, health] =
      request.channel === 'whatsapp'
        ? await Promise.all([
            loadConversation(db, request, identity),
            loadInstance(db, request),
            wantsHealth
              ? request.senderInstanceId
                ? loadHealthFactsForGateway(request.orgId, request.senderInstanceId, now)
                : Promise.resolve(undefined)
              : Promise.resolve(undefined),
          ])
        : [null, null, undefined];
    // Segunda leitura ao final: opt-out ou hold gravado durante a carga prevalece.
    const second = await loadAccess(request);
    return { ...base, access: mergeAccess(first, second), conversation, instance, health };
  } catch {
    return base;
  }
}

/** Carrega o contexto e decide. Nao consulta flags e nao envia nada. */
export async function evaluateSend(request: SendGatewayRequest, now: Date = new Date()): Promise<SendDecision> {
  try {
    return decideSend(await loadSendFacts(request, now));
  } catch {
    return deny(['context_unavailable'], now);
  }
}

// ---------------------------------------------------------------------------
// Shadow
// ---------------------------------------------------------------------------

export interface CurrentSendDecision {
  /** O que o fluxo atual vai fazer (true = vai enviar). */
  allowed: boolean;
}

export interface ShadowComparison {
  mode: GatewayMode;
  compared: boolean;
  diverged: boolean | null;
  gateway: { allowed: boolean; reasons: SendDenialReason[] } | null;
}

/**
 * Ponto de integracao em shadow. Com a flag desligada nao le dados nem registra.
 * Em shadow, decide, compara com a decisao atual e escreve um log estruturado
 * (somente ids e motivos, sem telefone, e-mail, corpo ou segredos).
 * Nunca lanca, nunca altera o fluxo chamador. `enforced` nao e integrado aqui.
 */
export async function runSendGatewayShadow(
  request: SendGatewayRequest,
  current: CurrentSendDecision,
): Promise<ShadowComparison> {
  const none: ShadowComparison = { mode: 'off', compared: false, diverged: null, gateway: null };
  try {
    const mode = await getGatewayMode();
    if (mode !== 'shadow') return { ...none, mode };

    const decision = await evaluateSend(request);
    const gateway = {
      allowed: decision.allowed,
      reasons: decision.allowed ? [] : decision.reasons,
    };
    const diverged = gateway.allowed !== current.allowed;
    console.warn(
      JSON.stringify({
        event: 'send_gateway_shadow',
        orgId: request.orgId,
        leadId: request.leadId,
        channel: request.channel,
        provider: decision.allowed ? decision.provider : null,
        current: current.allowed,
        gateway: gateway.allowed,
        reasons: gateway.reasons,
        diverged,
      }),
    );
    return { mode, compared: true, diverged, gateway };
  } catch {
    return none;
  }
}
