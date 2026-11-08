import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { ConsentKind } from './ownership.service';
import { isScopedFlagEnabled } from './flag-scope.service';

/**
 * Captura de consentimento de WhatsApp (append-only em `contact_consent_evidence`).
 *
 * Tres entradas gravam por aqui:
 *  1. Formulario/LP inbound (`consent_whatsapp=true` no payload)  -> opt_in `lead_form`.
 *  2. Mensagem inbound no WhatsApp (Meta e Evolution)             -> opt_in `inbound_message`;
 *     pedido de parar                                             -> opt_out `inbound_stop_request`.
 *  3. Rota `/api/v1/edge/consent` (fluxos de consentimento da Ana V4).
 *
 * Regras:
 *  - Flag `consent_capture_v1` (app_flags) com escopo por organizacao. Linha ausente,
 *    desligada ou erro de leitura: NADA e lido nem gravado.
 *  - Append-only: so INSERT. Nunca atualiza nem apaga.
 *  - Idempotente por (org, identidade, canal, kind, source, evidence.ref).
 *  - Opt-out vence: opt_in automatico nao e gravado sobre um opt_out vigente (o ultimo
 *    evento da identidade). O gateway le o ultimo evento, entao o opt_out segue valendo.
 *  - Evidencia guarda so referencias (id da mensagem, id do lead). Nunca o corpo da
 *    mensagem, telefone bruto, tokens ou segredos.
 *  - As origens daqui NAO estao em `CONTACT_REQUEST_SOURCES` do gateway: nao liberam a
 *    continuidade via Evolution, apenas o primeiro contato oficial (com template).
 *
 * Nao envia nada, nao altera cadencia nem enrollments.
 */
export const CONSENT_CAPTURE_FLAG_KEY = 'consent_capture_v1';

export const CONSENT_SOURCES = {
  form: 'lead_form',
  inboundMessage: 'inbound_message',
  inboundStop: 'inbound_stop_request',
  anaOptIn: 'ana_v4_opt_in',
  anaOptOut: 'ana_v4_opt_out',
  callVerbal: 'call_verbal_consent',
} as const;

/** Origens aceitas na rota da Ana V4 (lista fechada, nenhuma delas libera Evolution). */
export const EDGE_CONSENT_SOURCES: Record<ConsentKind, string> = {
  opt_in: CONSENT_SOURCES.anaOptIn,
  opt_out: CONSENT_SOURCES.anaOptOut,
};

const CHANNEL = 'whatsapp' as const;
const HISTORY_LIMIT = 200;
const MAX_REF_LENGTH = 200;

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

/**
 * Identidade canonica de WhatsApp: somente digitos, 10 a 15. Numero brasileiro sem
 * codigo de pais (10 ou 11 digitos) ganha o prefixo 55, para casar com E.164 sem "+"
 * (formato usado pelo gateway quando o chamador envia +55...).
 */
export function canonicalWhatsappIdentity(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length >= 12 && digits.length <= 15) return digits;
  return null;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_PATTERNS: readonly RegExp[] = [
  /\b(parar|pare|stop|sair|cancelar|descadastrar|descadastre|descadastra|unsubscribe)\b/,
  /\bpara de (me )?(enviar|mandar|ligar|chamar|escrever|contatar)\b/,
  /\bnao (quero|desejo) (mais )?(receber|contato|mensagens?|ligacoes?)\b/,
  /\bnao me (mande|envie|chame|ligue|escreva|procure|contate) mais\b/,
  /\b(remov\w+|tir\w+|exclu\w+) (o )?(meu )?(numero|contato|telefone|cadastro)\b/,
  /\b(remov\w+|tir\w+|exclu\w+) (me |meu \w+ )?(d[ao]s? )?(lista|listas|contatos)\b/,
];

/**
 * A mensagem pede para parar de receber contato? Conservador: na duvida, trata como
 * pedido (um falso opt_out so bloqueia envio; um falso negativo contata quem pediu para parar).
 */
export function isStopRequest(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = normalizeText(text);
  if (!t) return false;
  return STOP_PATTERNS.some((re) => re.test(t));
}

/** Aceite vindo de formulario: so `true` booleano ou a string "true" contam. */
export function isConsentFlag(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

function cleanRef(raw: unknown): string | null {
  const text = String(raw ?? '').trim().slice(0, MAX_REF_LENGTH);
  return text || null;
}

// ---------------------------------------------------------------------------
// Captura
// ---------------------------------------------------------------------------

export interface CaptureConsentInput {
  orgId: string;
  leadId: string;
  /** Telefone bruto; sera normalizado. */
  contact: string;
  kind: ConsentKind;
  source: string;
  /** Referencia da evidencia (id da mensagem, do lead, chave de idempotencia). Entra no dedupe. */
  ref: string;
  /** Extras escalares da evidencia (sem segredos nem corpo de mensagem). */
  extra?: Record<string, string | number | boolean | null>;
  /** Usuario que registrou a evidencia (coluna `created_by`). Ausente: automatico, grava null. */
  createdBy?: string | null;
  /** Exige que o lead nao tenha recebido contato nosso antes (fluxo "escreveu primeiro"). */
  requireLeadWroteFirst?: boolean;
}

export type ConsentCaptureOutcome =
  | { status: 'disabled' }
  | { status: 'recorded'; id: string }
  | { status: 'duplicate' }
  /** opt_in descartado: o ultimo evento da identidade e um opt_out. */
  | { status: 'skipped_opted_out' }
  | { status: 'already_opted_out' }
  | { status: 'skipped_not_first_contact' }
  | { status: 'invalid_input' }
  | { status: 'lead_not_found' }
  | { status: 'error' };

interface EvidenceRow {
  id: string;
  kind: ConsentKind;
  source: string;
  evidence: Record<string, unknown> | null;
  created_at: string;
}

type Db = ReturnType<typeof createServiceRoleClient>;
type Rows<T> = { data: T[] | null; error: { message: string } | null };

function buildEvidence(ref: string, extra: CaptureConsentInput['extra']): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(extra ?? {}).slice(0, 10)) {
    if (key === 'ref') continue;
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) continue;
    out[key] = typeof value === 'string' ? value.slice(0, 300) : value;
  }
  out.ref = ref;
  return out;
}

/** Mais recente primeiro; desempate por kind para o opt_out aparecer antes no mesmo instante. */
function sortLatestFirst(rows: EvidenceRow[]): EvidenceRow[] {
  return [...rows].sort((a, b) => {
    const diff = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
    if (a.kind === b.kind) return 0;
    return a.kind === 'opt_out' ? -1 : 1;
  });
}

export async function captureWhatsappConsent(input: CaptureConsentInput): Promise<ConsentCaptureOutcome> {
  try {
    if (!(await isScopedFlagEnabled(CONSENT_CAPTURE_FLAG_KEY, { orgId: input.orgId }))) {
      return { status: 'disabled' };
    }
    if (input.kind !== 'opt_in' && input.kind !== 'opt_out') return { status: 'invalid_input' };
    const source = String(input.source ?? '').trim().slice(0, 100);
    const ref = cleanRef(input.ref);
    const identity = canonicalWhatsappIdentity(input.contact);
    if (!source || !ref || !identity || !input.orgId || !input.leadId) return { status: 'invalid_input' };

    const db: Db = createServiceRoleClient();

    const lead = (await from(db, 'leads')
      .select('id')
      .eq('id', input.leadId)
      .eq('org_id', input.orgId)
      .limit(1)) as Rows<{ id: string }>;
    if (lead.error) return { status: 'error' };
    if (!lead.data || lead.data.length === 0) return { status: 'lead_not_found' };

    if (input.requireLeadWroteFirst) {
      // Responder a um envio nosso nao e pedido de contato: so conta se nao houve
      // nenhuma interacao de WhatsApp anterior alem das respostas do proprio lead.
      const prior = (await from(db, 'interactions')
        .select('id')
        .eq('org_id', input.orgId)
        .eq('lead_id', input.leadId)
        .eq('channel', CHANNEL)
        .neq('type', 'replied')
        .limit(1)) as Rows<{ id: string }>;
      if (prior.error) return { status: 'error' };
      if ((prior.data?.length ?? 0) > 0) return { status: 'skipped_not_first_contact' };
    }

    const history = (await from(db, 'contact_consent_evidence')
      .select('id, kind, source, evidence, created_at')
      .eq('org_id', input.orgId)
      .eq('contact_identity', identity)
      .eq('channel', CHANNEL)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)) as Rows<EvidenceRow>;
    if (history.error || !history.data) return { status: 'error' };

    const rows = sortLatestFirst(history.data);
    const duplicate = rows.some(
      (r) => r.kind === input.kind && r.source === source && r.evidence?.ref === ref,
    );
    if (duplicate) return { status: 'duplicate' };

    const latest = rows[0]?.kind ?? null;
    if (input.kind === 'opt_in' && latest === 'opt_out') return { status: 'skipped_opted_out' };
    if (input.kind === 'opt_out' && latest === 'opt_out') return { status: 'already_opted_out' };

    const inserted = (await from(db, 'contact_consent_evidence')
      .insert({
        org_id: input.orgId,
        lead_id: input.leadId,
        contact_identity: identity,
        channel: CHANNEL,
        kind: input.kind,
        source,
        evidence: buildEvidence(ref, input.extra),
        created_by: input.createdBy ?? null,
      })
      .select('id')
      .limit(1)) as Rows<{ id: string }>;
    const id = inserted.data?.[0]?.id;
    if (inserted.error || !id) return { status: 'error' };
    return { status: 'recorded', id };
  } catch {
    return { status: 'error' };
  }
}

// ---------------------------------------------------------------------------
// Atalhos por fluxo
// ---------------------------------------------------------------------------

/** Fluxo 1: lead criado por formulario/LP com `consent_whatsapp=true`. */
export function captureFormConsent(input: {
  orgId: string;
  leadId: string;
  phone: string;
  channelHint?: string | null;
}): Promise<ConsentCaptureOutcome> {
  return captureWhatsappConsent({
    orgId: input.orgId,
    leadId: input.leadId,
    contact: input.phone,
    kind: 'opt_in',
    source: CONSENT_SOURCES.form,
    ref: `lead:${input.leadId}`,
    extra: { origin: 'inbound_form', canal: input.channelHint ?? null },
  });
}

/**
 * Fluxo 2: mensagem inbound de WhatsApp. Pedido de parar grava opt_out (uma vez por
 * mensagem); qualquer outra mensagem grava opt_in uma unica vez por identidade.
 * O texto e usado so para classificar e nunca e gravado.
 */
export function captureInboundMessageConsent(input: {
  orgId: string;
  leadId: string;
  phone: string;
  messageId: string | null;
  text: string | null | undefined;
  provider: 'meta_cloud' | 'evolution';
}): Promise<ConsentCaptureOutcome> {
  const identity = canonicalWhatsappIdentity(input.phone);
  const stop = isStopRequest(input.text);
  const messageRef = cleanRef(input.messageId);
  if (stop) {
    return captureWhatsappConsent({
      orgId: input.orgId,
      leadId: input.leadId,
      contact: input.phone,
      kind: 'opt_out',
      source: CONSENT_SOURCES.inboundStop,
      ref: messageRef ?? `stop:${identity ?? 'unknown'}`,
      extra: { provider: input.provider, message_id: messageRef },
    });
  }
  return captureWhatsappConsent({
    orgId: input.orgId,
    leadId: input.leadId,
    contact: input.phone,
    kind: 'opt_in',
    source: CONSENT_SOURCES.inboundMessage,
    ref: `inbound:${identity ?? 'unknown'}`,
    extra: { provider: input.provider, first_message_id: messageRef },
    requireLeadWroteFirst: true,
  });
}
