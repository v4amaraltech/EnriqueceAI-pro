/**
 * Contact engine: contratos de tipos (PR01).
 *
 * Somente tipos. Nenhum codigo de runtime e nenhum import deste arquivo por
 * outros modulos. Documento de referencia: docs/architecture/call-cockpit-engine.md.
 *
 * Todos os nomes de flags, tabelas e campos aqui sao PROPOSTAS a validar nos PRs
 * seguintes (PR05 a PR08). Nada aqui descreve tabela ou rota existente, exceto
 * quando o comentario disser explicitamente que espelha um contrato atual.
 */

// ---------------------------------------------------------------------------
// Identidade e escopo
// ---------------------------------------------------------------------------

/** UUID em formato string. */
export type Uuid = string;

/** Instante em ISO 8601 com offset. */
export type IsoTimestamp = string;

/** Telefone em E.164 (ex.: +5516999867577). */
export type E164Phone = string;

/** Papeis existentes em `member_role`. */
export type MemberRole = 'manager' | 'sdr';

/** Identidade que autoriza um comando. Nunca carrega segredo ou token. */
export interface ActorIdentity {
  orgId: Uuid;
  /** Usuario humano, quando houver. */
  userId: Uuid | null;
  /** Origem tecnica do comando. */
  source: 'app' | 'cron' | 'n8n' | 'webhook' | 'api_key';
  /** Id da chave de API (api_keys.id), nunca o valor da chave. */
  apiKeyId: Uuid | null;
}

// ---------------------------------------------------------------------------
// Canais, provedores e flags
// ---------------------------------------------------------------------------

/** Subconjunto de `channel_type` relevante para o motor. */
export type ContactChannel = 'email' | 'whatsapp' | 'phone' | 'linkedin' | 'research';

/**
 * Provedores de WhatsApp. `meta_cloud` e a API oficial. `evolution` NAO e
 * equivalente e so pode ser usado em continuidade autorizada.
 */
export type WhatsAppProvider = 'meta_cloud' | 'evolution';

export type EmailProvider = 'gmail';

export type MessageProvider = WhatsAppProvider | EmailProvider;

/**
 * Flags propostas. Todas nascem DESLIGADAS. Flags de restricao de seguranca
 * sao fail-closed: ausente ou ilegivel significa bloquear, nunca liberar.
 */
export type ContactEngineFlag =
  | 'call_cockpit_v1'
  | 'call_cockpit_outcomes'
  | 'conversation_ownership_v1'
  | 'send_gateway_shadow'
  | 'send_gateway_enforced'
  | 'send_outbox_enqueue'
  | 'dispatcher_v1'
  | 'lead_assignment_shadow'
  | 'lead_assignment_enforced'
  | 'number_health_v1'
  | 'call_priority_v2'
  | 'edge_command_adapter'
  | 'edge_ingestion_v1';

export interface ContactEngineFlagState {
  flag: ContactEngineFlag;
  /** Escopo proposto: por organizacao. O escopo atual de app_flags e global. */
  orgId: Uuid;
  enabled: boolean;
  note: string | null;
  updatedAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Supressao e consentimento (contact_holds)
// ---------------------------------------------------------------------------

/** Espelha `HoldTipo` de features/contact-holds/services/hold-flags.ts. */
export type HoldScope = 'prospeccao' | 'conversa' | 'total';

/** Espelha `HoldFlags` do contrato atual de GET /api/v1/contacts/holds. */
export interface HoldFlagsContract {
  bloqueado_total: boolean;
  bloqueado_prospeccao: boolean;
  bloqueado_conversa: boolean;
}

/** Proposta de evolucao do registro de supressao (versao e trilha de origem). */
export interface SuppressionRecord {
  orgId: Uuid;
  leadId: Uuid;
  scope: HoldScope;
  /** Ex.: 'whatsapp_pediu_para_parar', 'whatsapp_respondeu' (valores atuais de origem). */
  origin: string;
  version: number;
  createdAt: IsoTimestamp;
}

export type ConsentBasis =
  | 'opt_in_explicit'
  | 'authorized_on_call'
  | 'user_requested_contact'
  | 'replied_to_conversation'
  | 'legitimate_interest_non_whatsapp';

/** Evidencia de consentimento. Sem evidencia, WhatsApp nao inicia conversa. */
export interface ConsentEvidence {
  orgId: Uuid;
  leadId: Uuid;
  contactPhone: E164Phone | null;
  channel: ContactChannel;
  basis: ConsentBasis;
  /** Para continuidade em Evolution: referencia ao pedido ou resposta que a justifica. */
  sourceInteractionId: Uuid | null;
  capturedAt: IsoTimestamp;
  revokedAt: IsoTimestamp | null;
}

// ---------------------------------------------------------------------------
// Ownership de conversa
// ---------------------------------------------------------------------------

export type AutomationMode = 'automatic' | 'human' | 'paused';

/** Registro canonico proposto (conversation_ownership). */
export interface ConversationOwnership {
  id: Uuid;
  orgId: Uuid;
  leadId: Uuid;
  contactId: Uuid | null;
  /** Responsavel comercial. Diferente de quem esta autorizado a falar. */
  ownerUserId: Uuid | null;
  automationMode: AutomationMode;
  provider: MessageProvider | null;
  senderInstanceId: Uuid | null;
  consentScope: HoldScope | 'none';
  /** Controle otimista: claim e transferencia fazem CAS por version. */
  version: number;
  updatedAt: IsoTimestamp;
}

export interface OwnershipTransferCommand {
  orgId: Uuid;
  leadId: Uuid;
  expectedVersion: number;
  toUserId: Uuid | null;
  reason: string;
  actor: ActorIdentity;
}

// ---------------------------------------------------------------------------
// Comando de envio e decisao do gateway
// ---------------------------------------------------------------------------

/** Motivos de recusa do gateway. Lista aberta a extensao nos PRs seguintes. */
export type SendDenialReason =
  | 'hold_total'
  | 'hold_prospeccao'
  | 'hold_conversa'
  | 'email_suppressed'
  | 'no_consent'
  | 'owner_mismatch'
  | 'recent_reply_requires_human'
  | 'channel_not_allowed'
  | 'evolution_requires_authorized_continuity'
  | 'outside_service_window_requires_template'
  | 'sender_paused'
  | 'sender_health_unknown'
  | 'daily_cap_reached'
  | 'lead_lost'
  | 'invalid_phone'
  | 'flag_disabled'
  | 'consent_opted_out'
  | 'context_unavailable'
  /** PR13: template do WhatsApp nao esta APPROVED na WABA da organizacao (ou idioma diferente). */
  | 'template_not_approved';

/** Pedido ao gateway. Descreve a intencao; nao envia nada. */
export interface SendIntent {
  orgId: Uuid;
  leadId: Uuid;
  enrollmentId: Uuid | null;
  stepId: Uuid | null;
  channel: ContactChannel;
  /** Preferencia; o gateway decide o provedor final. */
  preferredProvider: MessageProvider | null;
  requestedBy: ActorIdentity;
}

export type SendDecision =
  | {
      allowed: true;
      provider: MessageProvider;
      senderInstanceId: Uuid | null;
      /** Template oficial obrigatorio (inicio de conversa ou fora da janela de 24h). */
      requiresTemplate: boolean;
      templateId: string | null;
      ownershipVersion: number;
      consentEvidenceId: Uuid | null;
      decidedAt: IsoTimestamp;
    }
  | {
      allowed: false;
      reasons: SendDenialReason[];
      /** Ha algo a aguardar (ex.: teto) em vez de recusa definitiva? */
      retryable: boolean;
      decidedAt: IsoTimestamp;
    };

/** Modo de rollout do gateway. Shadow compara e nunca envia. */
export type GatewayMode = 'off' | 'shadow' | 'enforced';

// ---------------------------------------------------------------------------
// Outbox e idempotencia
// ---------------------------------------------------------------------------

/**
 * Estados da outbox proposta. `uncertain` significa que a mensagem pode ter
 * saido: aguarda reconciliacao, sem retry cego e sem fallback.
 */
export type OutboxStatus =
  | 'pending'
  | 'claimed'
  | 'sending'
  | 'accepted'
  | 'delivered'
  | 'failed'
  | 'uncertain'
  | 'cancelled';

/**
 * Chave comercial unica da acao: por lead, inscricao e etapa, independente do
 * provedor. Dois provedores jamais podem executar a mesma chave.
 */
export interface CommercialActionKey {
  orgId: Uuid;
  leadId: Uuid;
  enrollmentId: Uuid | null;
  stepId: Uuid | null;
  /** Tentativa comercial explicita. Retry tecnico NAO incrementa. */
  attempt: number;
}

export interface OutboxEntry {
  id: Uuid;
  key: CommercialActionKey;
  /** Forma serializada da chave, com indice unico por organizacao. */
  idempotencyKey: string;
  channel: ContactChannel;
  decision: Extract<SendDecision, { allowed: true }>;
  /** Payload fixado no enqueue; o executor nao o modifica. */
  payloadHash: string;
  status: OutboxStatus;
  leaseUntil: IsoTimestamp | null;
  leaseOwner: string | null;
  /** Id devolvido pelo provedor apos aceitacao. */
  externalId: string | null;
  version: number;
  expiresAt: IsoTimestamp;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** Evento append-only de send_events. */
export interface SendEvent {
  id: Uuid;
  orgId: Uuid;
  outboxId: Uuid;
  kind:
    | 'enqueued'
    | 'claimed'
    | 'revalidated'
    | 'sent_attempt'
    | 'accepted'
    | 'delivery_status'
    | 'failed'
    | 'marked_uncertain'
    | 'reconciled'
    | 'cancelled';
  /** Ids e motivos apenas. Sem segredos, tokens ou corpo de mensagem. */
  detail: Record<string, string | number | boolean | null>;
  occurredAt: IsoTimestamp;
}

/** Comando autorizado que um adaptador externo (n8n) pode executar. */
export interface AuthorizedSendCommand {
  outboxId: Uuid;
  idempotencyKey: string;
  provider: MessageProvider;
  senderInstanceId: Uuid | null;
  payloadHash: string;
  /** Comando vencido ou com hash divergente deve ser rejeitado. */
  expiresAt: IsoTimestamp;
}

/** Confirmacao devolvida pelo adaptador ao app. Idempotente por outboxId + kind. */
export interface SendConfirmation {
  outboxId: Uuid;
  idempotencyKey: string;
  outcome: 'accepted' | 'failed' | 'uncertain';
  externalId: string | null;
  error: string | null;
  reportedAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Saude e tetos por numero (Evolution)
// ---------------------------------------------------------------------------

export type NumberHealthState =
  | 'onboarding'
  | 'warming'
  | 'healthy'
  | 'degraded'
  | 'paused'
  | 'review';

/** `unknown` e usado quando nao ha telemetria confiavel. Nunca inferir ausencia de risco. */
export type HealthSignal<T> = { known: true; value: T } | { known: false };

export interface NumberHealthSnapshot {
  orgId: Uuid;
  senderInstanceId: Uuid;
  provider: WhatsAppProvider;
  state: NumberHealthState;
  newContactsCapToday: number;
  totalMessagesCapToday: number;
  replyRate: HealthSignal<number>;
  failureRate: HealthSignal<number>;
  reportedBlocks: HealthSignal<number>;
  pausedReason: string | null;
  asOf: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Contratos existentes (somente tipagem de documentacao)
// ---------------------------------------------------------------------------

/**
 * Resposta de GET /api/v1/contacts/holds?telefone=...
 * Espelha src/app/api/v1/contacts/holds/route.ts.
 */
export interface HoldsLookupResponse extends HoldFlagsContract {
  success: boolean;
  telefone: string;
  encontrado: boolean;
  lead_ids: string[];
  holds: Array<{
    lead_id: string;
    tipo: string;
    origem?: string | null;
    created_at?: string | null;
  }>;
}

/** Estado de execucao devolvido por /api/v1/bdr/steps/whatsapp (acao 'checar'). */
export type BdrWhatsAppCheckResponse =
  | {
      enviar: true;
      telefone: string;
      sinal: 'autorizou_na_ligacao' | 'respondeu_email' | 'abriu_emails';
    }
  | { enviar: false; motivo: string };

/** Desfecho de envio de e-mail do BDR (espelha `DesfechoEnvio` em bdr-steps). */
export type BdrEmailOutcome = 'enviado' | 'falhou_avanca' | 'caixa_indisponivel' | 'incerto';
