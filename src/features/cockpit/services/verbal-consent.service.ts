import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import {
  CONSENT_SOURCES,
  canonicalWhatsappIdentity,
  captureWhatsappConsent,
} from '@/features/contact-engine/services/consent-capture.service';
import { leadAnswerFromCallRow } from '@/features/integrations/webphone/webphone-lead-answer';

import { loadAccessibleCall, type CallAccessRow, type OutcomeActor } from './call-outcome.service';

/**
 * Aceite verbal de WhatsApp registrado pelo usuario durante ou logo apos uma
 * ligacao atendida (botao "Aceitou WhatsApp" do cockpit).
 *
 * Grava `opt_in` em `contact_consent_evidence` com source `call_verbal_consent`,
 * referencia ao `call_id` (idempotente por ligacao) e ao usuario que registrou.
 * Identidade no formato 55... (mesma do gateway). A flag `consent_capture_v1` e
 * conferida pela action; a escrita em si passa de novo pelo servico de captura,
 * que tambem respeita a flag e o "opt_out vence".
 *
 * IMPORTANTE (operacao): o primeiro template enviado apos este opt-in deve
 * referenciar a conversa ("conforme falamos na ligacao"). Template generico
 * nao representa o que foi combinado por telefone.
 */

/** Janela apos o atendimento em que o botao continua disponivel. */
export const VERBAL_CONSENT_WINDOW_MS = 30 * 60 * 1000;

export type VerbalConsentState = 'unknown' | 'available' | 'recorded' | 'unavailable';

export type VerbalConsentRecordResult =
  | { status: 'recorded' | 'already_recorded' }
  | { status: 'not_found' }
  | { status: 'not_answered' }
  | { status: 'window_expired' }
  | { status: 'opted_out' }
  | { status: 'invalid_phone' }
  | { status: 'error' };

type Eligibility =
  | { ok: true; call: CallAccessRow; leadId: string; phone: string }
  | { ok: false; reason: 'not_found' | 'not_answered' | 'unknown' | 'window_expired' | 'invalid_phone' | 'error' };

async function checkEligibility(
  supabase: SupabaseClient,
  actor: OutcomeActor,
  callId: string,
  now: Date,
): Promise<Eligibility> {
  const loaded = await loadAccessibleCall(supabase, actor, callId);
  if (!loaded) return { ok: false, reason: 'not_found' };
  if ('error' in loaded) return { ok: false, reason: 'error' };
  const { call } = loaded;
  if (!call.lead_id) return { ok: false, reason: 'not_found' };

  const answer = leadAnswerFromCallRow(call);
  if (answer === 'unknown') return { ok: false, reason: 'unknown' };
  if (answer === 'not_answered') return { ok: false, reason: 'not_answered' };

  const anchor = Date.parse(call.answered_at ?? call.started_at ?? '');
  if (Number.isNaN(anchor) || now.getTime() - anchor > VERBAL_CONSENT_WINDOW_MS) {
    return { ok: false, reason: 'window_expired' };
  }

  // Visibilidade do lead: leitura com o cliente do usuario (RLS) e dentro da org.
  const { data: lead, error } = (await from(supabase, 'leads')
    .select('id, telefone')
    .eq('id', call.lead_id)
    .eq('org_id', actor.orgId)
    .maybeSingle()) as { data: { id: string; telefone: string | null } | null; error: { message: string } | null };
  if (error) return { ok: false, reason: 'error' };
  if (!lead) return { ok: false, reason: 'not_found' };

  // Numero que atendeu a ligacao; cai para o telefone cadastrado do lead.
  const phone = [call.destination, lead.telefone].find((p) => canonicalWhatsappIdentity(p) !== null);
  if (!phone) return { ok: false, reason: 'invalid_phone' };
  return { ok: true, call, leadId: lead.id, phone };
}

/** Estado do botao para a ligacao. Somente leitura. */
export async function getVerbalConsentState(
  supabase: SupabaseClient,
  actor: OutcomeActor,
  callId: string,
  now: Date = new Date(),
): Promise<VerbalConsentState> {
  const eligibility = await checkEligibility(supabase, actor, callId, now);
  if (!eligibility.ok) return eligibility.reason === 'unknown' ? 'unknown' : 'unavailable';

  const { data, error } = (await from(supabase, 'contact_consent_evidence')
    .select('id, evidence')
    .eq('org_id', actor.orgId)
    .eq('source', CONSENT_SOURCES.callVerbal)
    .eq('contact_identity', canonicalWhatsappIdentity(eligibility.phone))
    .eq('kind', 'opt_in')
    .limit(200)) as { data: Array<{ id: string; evidence: { ref?: string } | null }> | null; error: unknown };
  if (error) return 'available';
  return (data ?? []).some((r) => r.evidence?.ref === `call:${callId}`) ? 'recorded' : 'available';
}

export async function recordVerbalConsent(
  supabase: SupabaseClient,
  actor: OutcomeActor,
  callId: string,
  now: Date = new Date(),
): Promise<VerbalConsentRecordResult> {
  const eligibility = await checkEligibility(supabase, actor, callId, now);
  if (!eligibility.ok) {
    if (eligibility.reason === 'unknown') return { status: 'not_answered' };
    return { status: eligibility.reason };
  }

  const outcome = await captureWhatsappConsent({
    orgId: actor.orgId,
    leadId: eligibility.leadId,
    contact: eligibility.phone,
    kind: 'opt_in',
    source: CONSENT_SOURCES.callVerbal,
    ref: `call:${callId}`,
    createdBy: actor.userId,
    extra: { origin: 'cockpit_call', call_id: callId, registered_by: actor.userId },
  });
  switch (outcome.status) {
    case 'recorded':
      return { status: 'recorded' };
    case 'duplicate':
      return { status: 'already_recorded' };
    case 'skipped_opted_out':
      return { status: 'opted_out' };
    case 'lead_not_found':
      return { status: 'not_found' };
    case 'invalid_input':
      return { status: 'invalid_phone' };
    default:
      return { status: 'error' };
  }
}
