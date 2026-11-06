// Inbound WhatsApp reply capture for the Evolution webhook.
//
// The org sends cadence WhatsApp via Evolution, so lead replies arrive here (not
// at the Meta WABA webhook where the reply-handling code lived). This mirrors that
// Meta path (src/app/api/webhooks/whatsapp/route.ts::processIncomingMessage):
// record a 'replied' interaction, stop the lead's active cadences, and notify the
// owning SDR (which also chimes client-side — 'whatsapp_reply' is a sound type).
import { supabaseAdmin } from './supabase-admin.ts';

import { type InboundReply, leadPhoneMatches, localPhoneVariants } from './evolution-events.ts';

export { type InboundReply, parseInboundMessage } from './evolution-events.ts';

/** app_flags key that turns WhatsApp reply capture on/off. */
export const REPLY_CAPTURE_FLAG = 'whatsapp_reply_capture_enabled';

export type ReplyCaptureResult =
  | { status: 'disabled' }
  | { status: 'ignored' }
  | { status: 'duplicate' }
  | { status: 'no_lead' }
  | { status: 'no_enrollment' }
  | { status: 'recorded'; leadId: string };

/**
 * Record an inbound WhatsApp reply for a lead in an ACTIVE cadence: replied
 * interaction + stop all active enrollments + notify the owning SDR. Scoped to
 * the instance's org. Requiring an active enrollment keeps normal WhatsApp
 * conversations (and post-stop follow-ups) from spamming notifications — only
 * the first reply that stops a running cadence notifies.
 */
export async function captureInboundReply(
  orgId: string,
  reply: InboundReply,
): Promise<ReplyCaptureResult> {
  // Kill switch (app_flags, sem deploy). Nunca funcionou em prod até 04/10/2026
  // (org errada + coluna errada); ligar muda o comportamento das cadências —
  // resposta no WhatsApp passa a parar TODAS as inscrições ativas do lead e a
  // notificar o SDR. Sem a linha = desligado.
  const { data: flag } = await supabaseAdmin
    .from('app_flags')
    .select('enabled')
    .eq('key', REPLY_CAPTURE_FLAG)
    .maybeSingle();
  if (!flag?.enabled) return { status: 'disabled' };

  // Lead first: most inbound messages are not from leads, and the duplicate
  // check below is scoped to the leads (cheap) instead of scanning interactions.
  // Match by DIGITS (find_lead_ids_by_phone — same source as the BDR phone
  // holds): exact string matching missed formatted numbers ("(11) 99999-8888")
  // — 14 of 51 inbound numbers matched on 01/10 vs 21 by digits. Both 9th-digit
  // forms are tried.
  const variants = localPhoneVariants(reply.phone);
  const leadIds = new Set<string>();
  for (const variant of variants) {
    const { data: ids, error: rpcErr } = await supabaseAdmin.rpc('find_lead_ids_by_phone', {
      p_org_id: orgId,
      p_phone_digits: variant,
    });
    // A failed query must not read as "no lead": that is how a wrong org id
    // (undefined) silently dropped every reply. Throw so the webhook returns 5xx.
    if (rpcErr) throw new Error(`lead lookup failed: ${rpcErr.message}`);
    for (const id of (ids ?? []) as string[]) if (id) leadIds.add(id);
  }
  if (leadIds.size === 0) return { status: 'no_lead' };

  // Keep only leads whose number is EXACTLY one of the variants (the RPC's
  // last-10-digits rule can match another DDD).
  const { data: candidates, error: candErr } = await supabaseAdmin
    .from('leads')
    .select('id, telefone, phones')
    .in('id', [...leadIds])
    .eq('org_id', orgId);
  if (candErr) throw new Error(`lead lookup failed: ${candErr.message}`);
  const candidateIds = (candidates ?? [])
    .filter((l: { telefone: string | null; phones: unknown }) => leadPhoneMatches(l.telefone, l.phones, variants))
    .map((l: { id: string }) => l.id);
  if (candidateIds.length === 0) return { status: 'no_lead' };

  // Idempotency: never record the same inbound message twice (webhook retries).
  if (reply.messageId) {
    const { data: existing, error: dupErr } = await supabaseAdmin
      .from('interactions')
      .select('id')
      .in('lead_id', candidateIds)
      .eq('channel', 'whatsapp')
      .eq('external_id', reply.messageId)
      .limit(1);
    if (dupErr) throw new Error(`duplicate check failed: ${dupErr.message}`);
    if (existing && existing.length > 0) return { status: 'duplicate' };
  }

  // Several leads can share a number: take the one in an active cadence (only
  // that one has something to stop), most recently enrolled first.
  // cadence_enrollments has no created_at — ordering by it made PostgREST error
  // out, the error went unchecked and every reply came back as "no_enrollment".
  const { data: enrollment, error: enrollErr } = await supabaseAdmin
    .from('cadence_enrollments')
    .select('id, lead_id, cadence_id, current_step, enrolled_by')
    .in('lead_id', candidateIds)
    .eq('status', 'active')
    .order('enrolled_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (enrollErr) throw new Error(`enrollment lookup failed: ${enrollErr.message}`);
  if (!enrollment) return { status: 'no_enrollment' };

  const { data: lead, error: leadErr } = await supabaseAdmin
    .from('leads')
    .select('id, org_id, nome_fantasia, razao_social, assigned_to')
    .eq('id', enrollment.lead_id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (leadErr) throw new Error(`lead lookup failed: ${leadErr.message}`);
  if (!lead) return { status: 'no_lead' };

  // The current whatsapp step, for A/B + timeline attribution (best-effort).
  const { data: step, error: stepErr } = await supabaseAdmin
    .from('cadence_steps')
    .select('id')
    .eq('cadence_id', enrollment.cadence_id)
    .eq('step_order', enrollment.current_step)
    .eq('channel', 'whatsapp')
    .maybeSingle();
  if (stepErr) console.warn(`[whatsapp-reply] step lookup failed (attribution only): ${stepErr.message}`);

  const { error: insertErr } = await supabaseAdmin.from('interactions').insert({
    org_id: lead.org_id,
    lead_id: lead.id,
    cadence_id: enrollment.cadence_id,
    step_id: step?.id ?? null,
    channel: 'whatsapp',
    type: 'replied',
    message_content: reply.text || null,
    external_id: reply.messageId || null,
    metadata: { from: reply.phone, detected_by: 'evolution_webhook', push_name: reply.pushName },
  });
  if (insertErr) throw new Error(`replied interaction insert failed: ${insertErr.message}`);

  // Any reply stops ALL active cadences for the lead (industry standard) so we
  // don't keep messaging after engagement.
  await supabaseAdmin
    .from('cadence_enrollments')
    .update({ status: 'replied', completed_at: new Date().toISOString() })
    .eq('lead_id', lead.id)
    .eq('status', 'active');

  const sdrUserId = lead.assigned_to ?? enrollment.enrolled_by;
  if (sdrUserId) {
    const leadName = lead.nome_fantasia ?? lead.razao_social ?? reply.phone;
    const body = reply.text
      ? reply.text.length > 100
        ? reply.text.slice(0, 100) + '...'
        : reply.text
      : 'Enviou uma mensagem no WhatsApp.';
    await supabaseAdmin.from('notifications').insert({
      org_id: lead.org_id,
      user_id: sdrUserId,
      type: 'whatsapp_reply',
      title: `Resposta WhatsApp: ${leadName}`,
      body,
      resource_type: 'lead',
      resource_id: lead.id,
      metadata: { message_id: reply.messageId, from: reply.phone },
    });
  }

  return { status: 'recorded', leadId: lead.id };
}
