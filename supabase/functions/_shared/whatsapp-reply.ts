// Inbound WhatsApp reply capture for the Evolution webhook.
//
// The org sends cadence WhatsApp via Evolution, so lead replies arrive here (not
// at the Meta WABA webhook where the reply-handling code lived). This mirrors that
// Meta path (src/app/api/webhooks/whatsapp/route.ts::processIncomingMessage):
// record a 'replied' interaction, stop the lead's active cadences, and notify the
// owning SDR (which also chimes client-side — 'whatsapp_reply' is a sound type).
import { supabaseAdmin } from './supabase-admin.ts';

export interface InboundReply {
  phone: string;
  text: string;
  messageId: string;
  pushName: string | null;
}

/**
 * Normalize an Evolution `messages.upsert` `data` payload into an inbound reply,
 * or null when it must be ignored: our own outbound (fromMe), groups, status
 * broadcasts, or a payload without a message key.
 */
export function parseInboundMessage(data: unknown): InboundReply | null {
  if (!data || typeof data !== 'object') return null;
  const container = data as Record<string, unknown>;
  const raw = Array.isArray(data)
    ? data[0]
    : Array.isArray(container.messages)
      ? (container.messages as unknown[])[0]
      : data;
  const msg = raw as Record<string, any> | undefined;
  const key = msg?.key;
  if (!key) return null;
  if (key.fromMe === true) return null; // our own outbound
  const jid = String(key.remoteJid ?? '');
  if (!jid) return null;
  if (jid.endsWith('@g.us') || jid.includes('broadcast')) return null; // group / status
  const phone = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!phone) return null;
  const m = (msg?.message ?? {}) as Record<string, any>;
  const text = String(
    m.conversation ??
      m.extendedTextMessage?.text ??
      m.ephemeralMessage?.message?.conversation ??
      m.ephemeralMessage?.message?.extendedTextMessage?.text ??
      m.imageMessage?.caption ??
      m.videoMessage?.caption ??
      m.documentMessage?.caption ??
      '',
  );
  return { phone, text, messageId: String(key.id ?? ''), pushName: (msg?.pushName as string) ?? null };
}

/**
 * Phone strings to match against leads.telefone, covering the Brazilian country
 * code (55) and 9th-digit variance both ways (leads may be stored either form).
 */
export function phoneCandidates(phone: string): string[] {
  const digits = phone.replace(/\D/g, '');
  const set = new Set<string>();
  const add = (p: string) => {
    if (p) {
      set.add(p);
      set.add('+' + p);
    }
  };
  add(digits);

  // Strip the 55 country code to get the local DDD + number.
  let local = digits;
  if (digits.startsWith('55') && digits.length >= 12) {
    local = digits.slice(2);
    add(local);
    add('55' + local);
  }

  // local = DDD(2) + number(8 or 9 digits) — toggle the 9th digit both ways.
  if (local.length === 11 && local[2] === '9') {
    const without = local.slice(0, 2) + local.slice(3);
    add(without);
    add('55' + without);
  } else if (local.length === 10) {
    const withNine = local.slice(0, 2) + '9' + local.slice(2);
    add(withNine);
    add('55' + withNine);
  }

  return [...set];
}

export type ReplyCaptureResult =
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
  // Idempotency: never record the same inbound message twice.
  if (reply.messageId) {
    const { data: existing } = await supabaseAdmin
      .from('interactions')
      .select('id')
      .eq('external_id', reply.messageId)
      .eq('channel', 'whatsapp')
      .maybeSingle();
    if (existing) return { status: 'duplicate' };
  }

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, org_id, nome_fantasia, razao_social, assigned_to')
    .eq('org_id', orgId)
    .in('telefone', phoneCandidates(reply.phone))
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lead) return { status: 'no_lead' };

  const { data: enrollment } = await supabaseAdmin
    .from('cadence_enrollments')
    .select('id, cadence_id, current_step, enrolled_by')
    .eq('lead_id', lead.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!enrollment) return { status: 'no_enrollment' };

  // The current whatsapp step, for A/B + timeline attribution (best-effort).
  const { data: step } = await supabaseAdmin
    .from('cadence_steps')
    .select('id')
    .eq('cadence_id', enrollment.cadence_id)
    .eq('step_order', enrollment.current_step)
    .eq('channel', 'whatsapp')
    .maybeSingle();

  await supabaseAdmin.from('interactions').insert({
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
