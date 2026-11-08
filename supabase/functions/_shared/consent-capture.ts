// Captura de consentimento de WhatsApp a partir de mensagem inbound da Evolution.
//
// Espelha src/features/contact-engine/services/consent-capture.service.ts (a edge
// function nao importa de src/). Mantenha as duas versoes alinhadas; os testes de
// cada lado cobrem as mesmas regras (tests/edge/consent-capture.test.ts).
//
// Regras: flag `consent_capture_v1` (app_flags, escopo por org via allow_org_ids),
// append-only, idempotente por (identidade, kind, source, evidence.ref), opt_out
// vence opt_in, "lead escreveu primeiro" para opt_in. Nunca grava o corpo da mensagem.
import { supabaseAdmin } from './supabase-admin.ts';

import { type InboundReply, leadPhoneMatches, localPhoneVariants } from './evolution-events.ts';

export const CONSENT_CAPTURE_FLAG = 'consent_capture_v1';
const SOURCE_INBOUND = 'inbound_message';
const SOURCE_STOP = 'inbound_stop_request';

export type ConsentCaptureResult =
  | { status: 'disabled' }
  | { status: 'no_lead' }
  | { status: 'recorded'; kind: 'opt_in' | 'opt_out' }
  | { status: 'duplicate' }
  | { status: 'skipped_opted_out' }
  | { status: 'already_opted_out' }
  | { status: 'skipped_not_first_contact' };

export function canonicalWhatsappIdentity(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length >= 12 && digits.length <= 15) return digits;
  return null;
}

const STOP_PATTERNS: readonly RegExp[] = [
  /\b(parar|pare|stop|sair|cancelar|descadastrar|descadastre|descadastra|unsubscribe)\b/,
  /\bpara de (me )?(enviar|mandar|ligar|chamar|escrever|contatar)\b/,
  /\bnao (quero|desejo) (mais )?(receber|contato|mensagens?|ligacoes?)\b/,
  /\bnao me (mande|envie|chame|ligue|escreva|procure|contate) mais\b/,
  /\b(remov\w+|tir\w+|exclu\w+) (o )?(meu )?(numero|contato|telefone|cadastro)\b/,
  /\b(remov\w+|tir\w+|exclu\w+) (me |meu \w+ )?(d[ao]s? )?(lista|listas|contatos)\b/,
];

export function isStopRequest(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t ? STOP_PATTERNS.some((re) => re.test(t)) : false;
}

/** Flag ligada para a org? Global (`enabled`) ou org em `allow_org_ids`. Erro/ausente = desligada. */
export async function isConsentCaptureEnabled(orgId: string): Promise<boolean> {
  if (!orgId) return false;
  const full = await supabaseAdmin
    .from('app_flags')
    .select('enabled, allow_org_ids')
    .eq('key', CONSENT_CAPTURE_FLAG)
    .limit(1);
  let row = full.data?.[0] as { enabled: boolean; allow_org_ids?: string[] | null } | undefined;
  if (full.error) {
    const plain = await supabaseAdmin.from('app_flags').select('enabled').eq('key', CONSENT_CAPTURE_FLAG).limit(1);
    if (plain.error) return false;
    row = plain.data?.[0] as { enabled: boolean } | undefined;
  }
  if (!row) return false;
  if (row.enabled === true) return true;
  const allow = Array.isArray(row.allow_org_ids) ? row.allow_org_ids.map((v) => String(v).toLowerCase()) : [];
  return allow.includes(orgId.toLowerCase());
}

interface EvidenceRow {
  kind: 'opt_in' | 'opt_out';
  source: string;
  evidence: Record<string, unknown> | null;
  created_at: string;
}

async function resolveLeadId(orgId: string, phone: string): Promise<string | null> {
  const variants = localPhoneVariants(phone);
  const ids = new Set<string>();
  for (const variant of variants) {
    const { data, error } = await supabaseAdmin.rpc('find_lead_ids_by_phone', {
      p_org_id: orgId,
      p_phone_digits: variant,
    });
    if (error) throw new Error(`lead lookup failed: ${error.message}`);
    for (const id of (data ?? []) as string[]) if (id) ids.add(id);
  }
  if (ids.size === 0) return null;
  const { data: leads, error } = await supabaseAdmin
    .from('leads')
    .select('id, telefone, phones')
    .in('id', [...ids])
    .eq('org_id', orgId);
  if (error) throw new Error(`lead lookup failed: ${error.message}`);
  const matches = (leads ?? [])
    .filter((l: { telefone: string | null; phones: unknown }) => leadPhoneMatches(l.telefone, l.phones, variants))
    .map((l: { id: string }) => l.id)
    .sort();
  return matches[0] ?? null;
}

/**
 * Grava opt_in (lead escreveu primeiro) ou opt_out (pedido de parar) para a mensagem inbound.
 * Erros de leitura/escrita sobem (o chamador decide se derruba o webhook).
 */
export async function captureInboundConsent(orgId: string, reply: InboundReply): Promise<ConsentCaptureResult> {
  if (!(await isConsentCaptureEnabled(orgId))) return { status: 'disabled' };

  const identity = canonicalWhatsappIdentity(reply.phone);
  if (!identity) return { status: 'no_lead' };
  const leadId = await resolveLeadId(orgId, reply.phone);
  if (!leadId) return { status: 'no_lead' };

  const stop = isStopRequest(reply.text);
  const kind = stop ? 'opt_out' : 'opt_in';
  const source = stop ? SOURCE_STOP : SOURCE_INBOUND;
  const ref = stop ? (reply.messageId || `stop:${identity}`) : `inbound:${identity}`;

  if (!stop) {
    const { data: prior, error: priorErr } = await supabaseAdmin
      .from('interactions')
      .select('id')
      .eq('org_id', orgId)
      .eq('lead_id', leadId)
      .eq('channel', 'whatsapp')
      .neq('type', 'replied')
      .limit(1);
    if (priorErr) throw new Error(`prior interaction lookup failed: ${priorErr.message}`);
    if ((prior ?? []).length > 0) return { status: 'skipped_not_first_contact' };
  }

  const { data: history, error: histErr } = await supabaseAdmin
    .from('contact_consent_evidence')
    .select('kind, source, evidence, created_at')
    .eq('org_id', orgId)
    .eq('contact_identity', identity)
    .eq('channel', 'whatsapp')
    .order('created_at', { ascending: false })
    .limit(200);
  if (histErr) throw new Error(`consent lookup failed: ${histErr.message}`);

  const rows = ((history ?? []) as EvidenceRow[])
    .slice()
    .sort((a, b) => {
      const diff = Date.parse(b.created_at) - Date.parse(a.created_at);
      if (diff !== 0 && !Number.isNaN(diff)) return diff;
      if (a.kind === b.kind) return 0;
      return a.kind === 'opt_out' ? -1 : 1;
    });
  if (rows.some((r) => r.kind === kind && r.source === source && r.evidence?.ref === ref)) {
    return { status: 'duplicate' };
  }
  const latest = rows[0]?.kind ?? null;
  if (kind === 'opt_in' && latest === 'opt_out') return { status: 'skipped_opted_out' };
  if (kind === 'opt_out' && latest === 'opt_out') return { status: 'already_opted_out' };

  const { error: insErr } = await supabaseAdmin.from('contact_consent_evidence').insert({
    org_id: orgId,
    lead_id: leadId,
    contact_identity: identity,
    channel: 'whatsapp',
    kind,
    source,
    evidence: { ref, provider: 'evolution', message_id: reply.messageId || null },
    created_by: null,
  });
  if (insErr) throw new Error(`consent insert failed: ${insErr.message}`);
  return { status: 'recorded', kind };
}
