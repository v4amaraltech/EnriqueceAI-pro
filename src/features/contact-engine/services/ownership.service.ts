import type { ActionResult } from '@/lib/actions/action-result';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { resolveHoldFlags, type HoldFlags, type HoldRow } from '@/features/contact-holds/services/hold-flags';

import type { ActorIdentity, AutomationMode, ContactChannel, MessageProvider, Uuid } from '../types';

/**
 * Ownership canonico de conversa e evidencia de consentimento (PR05).
 *
 * Flag `conversation_ownership_v1` em `app_flags` (escopo GLOBAL, mesmo mecanismo
 * de `call_cockpit_v1`). Nasce desligada; em erro de leitura vale desligada.
 * Com a flag desligada NENHUMA escrita acontece e as leituras nao consultam
 * tabelas de dados (a leitura de acesso responde fail-closed com `flag_disabled`).
 *
 * Isolamento: este servico usa service role, entao a organizacao do ator e
 * verificada aqui (lead e usuario de destino precisam pertencer a `actor.orgId`)
 * e tambem dentro das RPCs. Toda consulta filtra por `org_id`.
 *
 * Nada aqui envia mensagem, altera cadencia ou transfere carteira.
 */
export const CONVERSATION_OWNERSHIP_FLAG_KEY = 'conversation_ownership_v1';

const MAX_REASON_LENGTH = 500;
const MAX_EVIDENCE_KEYS = 20;
const MAX_EVIDENCE_VALUE_LENGTH = 300;
const ACTIVE_MEMBER_STATUS = 'active';

export async function isConversationOwnershipEnabled(): Promise<boolean> {
  try {
    const client = createServiceRoleClient();
    const { data } = (await from(client, 'app_flags')
      .select('enabled')
      .eq('key', CONVERSATION_OWNERSHIP_FLAG_KEY)
      .limit(1)) as { data: Array<{ enabled: boolean }> | null };
    return data?.[0]?.enabled === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface OwnershipRecord {
  id: Uuid;
  orgId: Uuid;
  leadId: Uuid;
  contactId: Uuid | null;
  contactIdentity: string;
  channel: ContactChannel;
  ownerUserId: Uuid | null;
  automationMode: AutomationMode;
  provider: MessageProvider | null;
  version: number;
  updatedAt: string;
}

export interface OwnershipClaimResult {
  ownershipId: Uuid;
  ownerUserId: Uuid | null;
  version: number;
  /** `already_owner`: o mesmo usuario ja detinha a conversa (idempotente). */
  outcome: 'claimed' | 'already_owner';
}

export interface OwnershipTransferResult {
  ownershipId: Uuid;
  ownerUserId: Uuid | null;
  version: number;
  outcome: 'transferred' | 'released';
}

export type ConsentKind = 'opt_in' | 'opt_out';

export type ContactAccessDenial = 'flag_disabled' | 'hold_total' | 'consent_opted_out';

export interface ContactAccess {
  /** Falso se houver hold total, opt-out vigente ou flag desligada. */
  allowed: boolean;
  reasons: ContactAccessDenial[];
  holds: HoldFlags;
  /** Ultimo evento de consentimento da identidade neste canal, se existir. */
  lastConsent: ConsentKind | null;
  owner: OwnershipRecord | null;
}

type Failure = Extract<ActionResult<never>, { success: false }>;

const fail = (error: string, code: string): Failure => ({ success: false, error, code });

// ---------------------------------------------------------------------------
// Normalizacao de identidade
// ---------------------------------------------------------------------------

const CHANNELS: readonly ContactChannel[] = ['email', 'whatsapp', 'phone', 'linkedin', 'research'];

export function isContactChannel(value: unknown): value is ContactChannel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
}

/**
 * Identidade normalizada do contato: telefone (whatsapp, phone) so em digitos,
 * 10 a 15; e-mail em minusculas; demais canais, texto aparado em minusculas.
 * Devolve null se invalida.
 */
export function normalizeContactIdentity(channel: ContactChannel, raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (channel === 'whatsapp' || channel === 'phone') {
    const digits = text.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15 ? digits : null;
  }
  if (channel === 'email') {
    const email = text.toLowerCase();
    return /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
  }
  return text.toLowerCase();
}

function cleanReason(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  return text ? text.slice(0, MAX_REASON_LENGTH) : null;
}

// ---------------------------------------------------------------------------
// Acesso a dados
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof createServiceRoleClient>;

interface RpcRow {
  outcome: string;
  ownership_id: string | null;
  owner_user_id: string | null;
  version: number | null;
}

async function leadBelongsToOrg(db: Db, orgId: Uuid, leadId: Uuid): Promise<boolean | null> {
  const { data, error } = (await from(db, 'leads')
    .select('id')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .limit(1)) as { data: Array<{ id: string }> | null; error: { message: string } | null };
  if (error) return null;
  return (data?.length ?? 0) > 0;
}

async function isActiveMember(db: Db, orgId: Uuid, userId: Uuid): Promise<boolean | null> {
  const { data, error } = (await from(db, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('status', ACTIVE_MEMBER_STATUS)
    .limit(1)) as { data: Array<{ user_id: string }> | null; error: { message: string } | null };
  if (error) return null;
  return (data?.length ?? 0) > 0;
}

async function callRpc(db: Db, fn: string, args: Record<string, unknown>) {
  const { data, error } = (await db.rpc(fn as never, args as never)) as unknown as {
    data: RpcRow[] | RpcRow | null;
    error: { message: string } | null;
  };
  if (error) return { row: null, failed: true as const };
  const row = Array.isArray(data) ? data[0] : data;
  return { row: row ?? null, failed: false as const };
}

function mapOwnership(row: Record<string, unknown>): OwnershipRecord {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    leadId: String(row.lead_id),
    contactId: (row.contact_id as string | null) ?? null,
    contactIdentity: String(row.contact_identity),
    channel: row.channel as ContactChannel,
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    automationMode: row.automation_mode as AutomationMode,
    provider: (row.provider as MessageProvider | null) ?? null,
    version: Number(row.version),
    updatedAt: String(row.updated_at),
  };
}

const OWNERSHIP_COLUMNS =
  'id, org_id, lead_id, contact_id, contact_identity, channel, owner_user_id, automation_mode, provider, version, updated_at';

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

export interface ClaimConversationInput {
  actor: ActorIdentity;
  leadId: Uuid;
  /** Telefone ou e-mail bruto; sera normalizado. */
  contact: string;
  /** `lead_contacts.id`, quando o contato existe como entidade. */
  contactId?: Uuid | null;
  channel: ContactChannel;
  ownerUserId: Uuid;
  provider?: MessageProvider | null;
  automationMode?: AutomationMode;
  reason?: string | null;
}

export async function claimConversation(
  input: ClaimConversationInput,
): Promise<ActionResult<OwnershipClaimResult>> {
  if (!(await isConversationOwnershipEnabled())) {
    return fail('Ownership de conversa desativado', 'flag_disabled');
  }
  const identity = normalizeContactIdentity(input.channel, input.contact);
  if (!identity) return fail('Contato invalido para o canal', 'invalid_contact');

  const db = createServiceRoleClient();
  const { orgId } = input.actor;

  const inOrg = await leadBelongsToOrg(db, orgId, input.leadId);
  if (inOrg === null) return fail('Falha ao validar o lead', 'read_failed');
  if (!inOrg) return fail('Lead nao encontrado', 'not_found');

  const memberOk = await isActiveMember(db, orgId, input.ownerUserId);
  if (memberOk === null) return fail('Falha ao validar o responsavel', 'read_failed');
  if (!memberOk) return fail('Responsavel nao pertence a organizacao', 'not_found');

  const { row, failed } = await callRpc(db, 'claim_conversation_ownership', {
    p_org_id: orgId,
    p_lead_id: input.leadId,
    p_contact_identity: identity,
    p_channel: input.channel,
    p_user_id: input.ownerUserId,
    p_contact_id: input.contactId ?? null,
    p_provider: input.provider ?? null,
    p_automation_mode: input.automationMode ?? 'human',
    p_actor_user_id: input.actor.userId,
    p_actor_source: input.actor.source,
    p_reason: cleanReason(input.reason),
  });
  if (failed || !row) return fail('Falha ao registrar ownership', 'write_failed');

  switch (row.outcome) {
    case 'claimed':
    case 'already_owner':
      return {
        success: true,
        data: {
          ownershipId: String(row.ownership_id),
          ownerUserId: row.owner_user_id,
          version: Number(row.version),
          outcome: row.outcome,
        },
      };
    case 'conflict':
      return fail('Conversa ja pertence a outro responsavel', 'conflict');
    case 'lead_not_in_org':
      return fail('Lead nao encontrado', 'not_found');
    default:
      return fail('Resposta inesperada do banco', 'write_failed');
  }
}

// ---------------------------------------------------------------------------
// Transferencia (handoff auditado)
// ---------------------------------------------------------------------------

export interface TransferConversationInput {
  actor: ActorIdentity;
  contact: string;
  channel: ContactChannel;
  expectedVersion: number;
  /** null libera a conversa (sem dono). */
  toUserId: Uuid | null;
  /** Obrigatorio: vai para a trilha de auditoria. */
  reason: string;
}

export async function transferConversation(
  input: TransferConversationInput,
): Promise<ActionResult<OwnershipTransferResult>> {
  if (!(await isConversationOwnershipEnabled())) {
    return fail('Ownership de conversa desativado', 'flag_disabled');
  }
  const reason = cleanReason(input.reason);
  if (!reason) return fail('Motivo obrigatorio', 'invalid_input');
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return fail('Versao esperada invalida', 'invalid_input');
  }
  const identity = normalizeContactIdentity(input.channel, input.contact);
  if (!identity) return fail('Contato invalido para o canal', 'invalid_contact');

  const db = createServiceRoleClient();
  const { orgId } = input.actor;

  if (input.toUserId) {
    const memberOk = await isActiveMember(db, orgId, input.toUserId);
    if (memberOk === null) return fail('Falha ao validar o destinatario', 'read_failed');
    if (!memberOk) return fail('Destinatario nao pertence a organizacao', 'not_found');
  }

  const { row, failed } = await callRpc(db, 'transfer_conversation_ownership', {
    p_org_id: orgId,
    p_contact_identity: identity,
    p_channel: input.channel,
    p_expected_version: input.expectedVersion,
    p_to_user_id: input.toUserId,
    p_reason: reason,
    p_actor_user_id: input.actor.userId,
    p_actor_source: input.actor.source,
  });
  if (failed || !row) return fail('Falha ao transferir ownership', 'write_failed');

  switch (row.outcome) {
    case 'transferred':
    case 'released':
      return {
        success: true,
        data: {
          ownershipId: String(row.ownership_id),
          ownerUserId: row.owner_user_id,
          version: Number(row.version),
          outcome: row.outcome,
        },
      };
    case 'version_conflict':
      return fail('Versao desatualizada: a conversa mudou', 'version_conflict');
    case 'not_found':
      return fail('Conversa nao encontrada', 'not_found');
    default:
      return fail('Resposta inesperada do banco', 'write_failed');
  }
}

// ---------------------------------------------------------------------------
// Leitura de dono
// ---------------------------------------------------------------------------

export interface GetOwnerInput {
  orgId: Uuid;
  contact: string;
  channel: ContactChannel;
}

/** Dono ativo da conversa na organizacao, ou null. Flag desligada: null sem consultar. */
export async function getOwner(input: GetOwnerInput): Promise<ActionResult<OwnershipRecord | null>> {
  if (!(await isConversationOwnershipEnabled())) return { success: true, data: null };
  const identity = normalizeContactIdentity(input.channel, input.contact);
  if (!identity) return fail('Contato invalido para o canal', 'invalid_contact');

  const owner = await readActiveOwner(createServiceRoleClient(), input.orgId, identity, input.channel);
  if (owner === undefined) return fail('Falha ao ler ownership', 'read_failed');
  return { success: true, data: owner };
}

/** Todos os donos ativos de um lead (lead com varios contatos). */
export async function listLeadOwners(input: {
  orgId: Uuid;
  leadId: Uuid;
}): Promise<ActionResult<OwnershipRecord[]>> {
  if (!(await isConversationOwnershipEnabled())) return { success: true, data: [] };
  const { data, error } = (await from(createServiceRoleClient(), 'conversation_ownership')
    .select(OWNERSHIP_COLUMNS)
    .eq('org_id', input.orgId)
    .eq('lead_id', input.leadId)
    .eq('status', 'active')) as {
    data: Array<Record<string, unknown>> | null;
    error: { message: string } | null;
  };
  if (error) return fail('Falha ao ler ownership', 'read_failed');
  return { success: true, data: (data ?? []).map(mapOwnership) };
}

/** undefined = erro de leitura; null = sem dono. */
async function readActiveOwner(
  db: Db,
  orgId: Uuid,
  identity: string,
  channel: ContactChannel,
): Promise<OwnershipRecord | null | undefined> {
  const { data, error } = (await from(db, 'conversation_ownership')
    .select(OWNERSHIP_COLUMNS)
    .eq('org_id', orgId)
    .eq('contact_identity', identity)
    .eq('channel', channel)
    .eq('status', 'active')
    .limit(1)) as { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
  if (error) return undefined;
  const row = data?.[0];
  return row ? mapOwnership(row) : null;
}

// ---------------------------------------------------------------------------
// Consentimento
// ---------------------------------------------------------------------------

export interface RecordConsentInput {
  actor: ActorIdentity;
  leadId: Uuid;
  contact: string;
  channel: ContactChannel;
  kind: ConsentKind;
  /** Origem da evidencia (ex.: 'authorized_on_call', 'whatsapp_pediu_para_parar'). */
  source: string;
  /** Referencias e resumo (ids). Sem segredos, tokens ou corpo de mensagem. */
  evidence?: Record<string, string | number | boolean | null>;
}

function sanitizeEvidence(
  raw: RecordConsentInput['evidence'],
): Record<string, string | number | boolean | null> | null {
  const entries = Object.entries(raw ?? {});
  if (entries.length > MAX_EVIDENCE_KEYS) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of entries) {
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return null;
    out[key] = typeof value === 'string' ? value.slice(0, MAX_EVIDENCE_VALUE_LENGTH) : value;
  }
  return out;
}

/** Insere evidencia append-only. Nunca atualiza nem apaga registros anteriores. */
export async function recordConsent(input: RecordConsentInput): Promise<ActionResult<{ id: Uuid }>> {
  if (!(await isConversationOwnershipEnabled())) {
    return fail('Ownership de conversa desativado', 'flag_disabled');
  }
  if (input.kind !== 'opt_in' && input.kind !== 'opt_out') {
    return fail('Tipo de consentimento invalido', 'invalid_input');
  }
  const source = String(input.source ?? '').trim().slice(0, 100);
  if (!source) return fail('Origem obrigatoria', 'invalid_input');
  const evidence = sanitizeEvidence(input.evidence);
  if (!evidence) return fail('Evidencia invalida', 'invalid_input');
  const identity = normalizeContactIdentity(input.channel, input.contact);
  if (!identity) return fail('Contato invalido para o canal', 'invalid_contact');

  const db = createServiceRoleClient();
  const { orgId } = input.actor;

  const inOrg = await leadBelongsToOrg(db, orgId, input.leadId);
  if (inOrg === null) return fail('Falha ao validar o lead', 'read_failed');
  if (!inOrg) return fail('Lead nao encontrado', 'not_found');

  const { data, error } = (await from(db, 'contact_consent_evidence')
    .insert({
      org_id: orgId,
      lead_id: input.leadId,
      contact_identity: identity,
      channel: input.channel,
      kind: input.kind,
      source,
      evidence,
      created_by: input.actor.userId,
    })
    .select('id')
    .limit(1)) as { data: Array<{ id: string }> | null; error: { message: string } | null };
  const id = data?.[0]?.id;
  if (error || !id) return fail('Falha ao registrar consentimento', 'write_failed');
  return { success: true, data: { id } };
}

// ---------------------------------------------------------------------------
// Leitura integrada com contact-holds
// ---------------------------------------------------------------------------

export interface GetContactAccessInput {
  orgId: Uuid;
  leadId: Uuid;
  contact: string;
  channel: ContactChannel;
}

const NO_HOLDS: HoldFlags = { bloqueado_total: false, bloqueado_prospeccao: false, bloqueado_conversa: false };

/**
 * Decide se o contato pode ser abordado segundo ownership, holds e consentimento.
 * Bloqueia (`allowed: false`) com hold `total`, ultimo consentimento `opt_out` ou
 * flag desligada (fail-closed). Os holds `prospeccao` e `conversa` sao devolvidos
 * em `holds` para o gateway decidir; `total` ja implica ambos.
 * Erro de leitura devolve falha, nunca `allowed: true`.
 */
export async function getContactAccess(input: GetContactAccessInput): Promise<ActionResult<ContactAccess>> {
  if (!(await isConversationOwnershipEnabled())) {
    return {
      success: true,
      data: { allowed: false, reasons: ['flag_disabled'], holds: NO_HOLDS, lastConsent: null, owner: null },
    };
  }
  const identity = normalizeContactIdentity(input.channel, input.contact);
  if (!identity) return fail('Contato invalido para o canal', 'invalid_contact');

  const db = createServiceRoleClient();
  const { orgId, leadId, channel } = input;

  const [holdsRes, consentRes, owner] = await Promise.all([
    from(db, 'contact_holds').select('lead_id, tipo, origem, created_at').eq('org_id', orgId).eq('lead_id', leadId) as unknown as Promise<{
      data: HoldRow[] | null;
      error: { message: string } | null;
    }>,
    from(db, 'contact_consent_evidence')
      .select('kind')
      .eq('org_id', orgId)
      .eq('contact_identity', identity)
      .eq('channel', channel)
      .order('created_at', { ascending: false })
      .limit(1) as unknown as Promise<{ data: Array<{ kind: ConsentKind }> | null; error: { message: string } | null }>,
    readActiveOwner(db, orgId, identity, channel),
  ]);
  if (holdsRes.error || consentRes.error || owner === undefined) {
    return fail('Falha ao ler contexto de contato', 'read_failed');
  }

  const holds = resolveHoldFlags(holdsRes.data ?? []);
  const lastConsent = consentRes.data?.[0]?.kind ?? null;
  const reasons: ContactAccessDenial[] = [];
  if (holds.bloqueado_total) reasons.push('hold_total');
  if (lastConsent === 'opt_out') reasons.push('consent_opted_out');

  return { success: true, data: { allowed: reasons.length === 0, reasons, holds, lastConsent, owner } };
}
