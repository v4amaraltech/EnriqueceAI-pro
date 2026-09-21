import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';

import { classifyInbound, extractEmailAddress, stripQuotedReply } from '../services/inbound-classifier';
import {
  getMailboxAccessToken, getMessageFull, listBdrMailboxes, listNewMessageIds, type BdrMailbox,
} from '../services/gmail-inbox.service';

const OVERLAP_MS = 24 * 3600 * 1000;      // sobreposição sobre o último ponto processado
const COLD_START_DAYS = 30;                // sem ponto confiável: recuperação ampla (com alerta)
const MAX_PER_MAILBOX_PER_RUN = 200;

export interface IngestResult {
  mailboxes: number;
  novas: number;
  conversas: number;
  ignoradas: number;
  erros: string[];
}

/**
 * BDR-3 — Ingestão contínua da caixa do BDR IA, independente da cadência.
 * Cada mensagem tem identidade única (caixa + gmail_message_id). Mensagens de
 * lead alimentam a conversa e disparam `email.replied` para o agente (n8n).
 * A primeira resposta marca as inscrições como replied e cria hold de
 * prospecção — encerra a prospecção fria, não a escuta.
 */
export async function ingestEmailInbox(): Promise<{ success: boolean; data?: IngestResult; error?: string }> {
  const supabase = createServiceRoleClient();
  const out: IngestResult = { mailboxes: 0, novas: 0, conversas: 0, ignoradas: 0, erros: [] };
  const mailboxes = await listBdrMailboxes(supabase);
  const ownEmails = mailboxes.map((m) => m.email_address.toLowerCase());

  for (const mb of mailboxes) {
    out.mailboxes++;
    try {
      const r = await ingestMailbox(supabase, mb, ownEmails);
      out.novas += r.novas; out.conversas += r.conversas; out.ignoradas += r.ignoradas;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.erros.push(`${mb.email_address}: ${msg}`);
      console.error(`[inbox] ${mb.email_address} falhou:`, msg);
    }
  }
  return { success: true, data: out };
}

async function ingestMailbox(supabase: SupabaseClient, mb: BdrMailbox, ownEmails: string[]) {
  const res = { novas: 0, conversas: 0, ignoradas: 0 };
  const token = await getMailboxAccessToken(supabase, mb);
  if (!token) return res;

  const coldStart = !mb.history_id && !mb.last_processed_internal_date;
  const afterDate = mb.last_processed_internal_date
    ? new Date(new Date(mb.last_processed_internal_date).getTime() - OVERLAP_MS)
    : new Date(Date.now() - COLD_START_DAYS * 86400000);
  if (coldStart) console.warn(`[inbox] ${mb.email_address}: sem ponto confiável — recuperação ampla de ${COLD_START_DAYS} dias (agente não responde mensagens antigas sem revisão)`);

  const listed = await listNewMessageIds(token, { historyId: mb.history_id, afterDate });
  if (listed.historyExpired) console.warn(`[inbox] ${mb.email_address}: historyId expirado — ressincronizado por lista desde ${afterDate.toISOString()}`);

  let maxInternal: Date | null = mb.last_processed_internal_date ? new Date(mb.last_processed_internal_date) : null;
  const ids = listed.ids.slice(0, MAX_PER_MAILBOX_PER_RUN);

  for (const id of ids) {
    // Identidade única: quem já foi gravado não é reprocessado (recuperação idempotente)
    const { data: existing } = (await from(supabase, 'email_inbound')
      .select('id').eq('mailbox_user_id', mb.user_id).eq('gmail_message_id', id).maybeSingle()) as { data: { id: string } | null };
    if (existing) { res.ignoradas++; continue; }

    const msg = await getMessageFull(token, id);
    if (!msg) { res.ignoradas++; continue; }

    const fromEmail = extractEmailAddress(msg.headers['from']);
    const { data: existingConv } = msg.threadId
      ? ((await from(supabase, 'email_conversations').select('id, lead_id, estado').eq('mailbox_user_id', mb.user_id).eq('thread_id', msg.threadId).maybeSingle()) as { data: { id: string; lead_id: string; estado: string } | null })
      : { data: null };

    const kind = classifyInbound({ headers: msg.headers, ownEmails, isKnownLeadSender: Boolean(existingConv), mimeType: msg.mimeType });

    // Lead: pelo e-mail do remetente (na org) ou pela conversa da thread
    let leadId: string | null = existingConv?.lead_id ?? null;
    if (!leadId && kind === 'lead' && fromEmail) {
      const { data: lead } = (await from(supabase, 'leads').select('id').eq('org_id', mb.org_id).ilike('email', fromEmail).is('deleted_at', null).limit(1).maybeSingle()) as { data: { id: string } | null };
      leadId = lead?.id ?? null;
    }
    const finalKind = kind === 'lead' && !leadId ? 'unknown' : kind;

    const { data: inserted } = (await from(supabase, 'email_inbound')
      .insert({
        org_id: mb.org_id, mailbox_user_id: mb.user_id, gmail_message_id: msg.id, thread_id: msg.threadId,
        rfc_message_id: msg.headers['message-id'] ?? null, in_reply_to: msg.headers['in-reply-to'] ?? null,
        from_email: fromEmail, subject: msg.headers['subject'] ?? null, snippet: msg.snippet.slice(0, 500),
        body_text: stripQuotedReply(msg.text).slice(0, 20000), internal_date: msg.internalDate.toISOString(),
        kind: finalKind, lead_id: leadId, conversation_id: existingConv?.id ?? null,
      } as Record<string, unknown>)
      .select('id').maybeSingle()) as { data: { id: string } | null };
    if (!inserted) { res.ignoradas++; continue; } // corrida com outra execução: já gravado
    res.novas++;
    if (!maxInternal || msg.internalDate > maxInternal) maxInternal = msg.internalDate;

    if (finalKind === 'bounce' && leadId) {
      await from(supabase, 'leads').update({ email_bounced_at: new Date().toISOString() } as Record<string, unknown>).eq('id', leadId).is('email_bounced_at', null);
    }
    if (finalKind !== 'lead' || !leadId) continue;

    // Conversa: uma por lead + thread; reabre se estava encerrada; humano_assumiu fica
    let conv = existingConv;
    if (!conv) {
      const { data: created } = (await from(supabase, 'email_conversations')
        .insert({ org_id: mb.org_id, lead_id: leadId, mailbox_user_id: mb.user_id, thread_id: msg.threadId, estado: 'ia_ativa', ultima_msg_lead_at: msg.internalDate.toISOString() } as Record<string, unknown>)
        .select('id, lead_id, estado').maybeSingle()) as { data: { id: string; lead_id: string; estado: string } | null };
      conv = created;
      res.conversas++;
    } else {
      const novoEstado = conv.estado === 'aguardando_lead' || conv.estado === 'encerrada' ? 'ia_ativa' : conv.estado;
      await from(supabase, 'email_conversations')
        .update({ ultima_msg_lead_at: msg.internalDate.toISOString(), estado: novoEstado } as Record<string, unknown>).eq('id', conv.id);
      conv = { ...conv, estado: novoEstado };
    }
    if (!conv) continue;
    await from(supabase, 'email_inbound').update({ conversation_id: conv.id } as Record<string, unknown>).eq('id', inserted.id);

    await marcarRespondeuSeForPrimeira(supabase, mb, leadId, inserted.id);

    // Gatilho do agente (n8n): toda mensagem de lead, com o estado atual da conversa
    dispatchWebhookEvent(supabase, mb.org_id, 'email.replied', {
      lead_id: leadId, conversation_id: conv.id, conversation_estado: conv.estado, inbound_id: inserted.id,
      thread_id: msg.threadId, mailbox_user_id: mb.user_id, mailbox_email: mb.email_address, source: 'bdr_inbox',
    });
  }

  // Cursor: só avança com o que foi comprovadamente gravado
  await from(supabase, 'gmail_connections').update({
    history_id: listed.historyId ?? mb.history_id,
    last_processed_internal_date: maxInternal ? maxInternal.toISOString() : mb.last_processed_internal_date,
  } as Record<string, unknown>).eq('id', mb.id);

  return res;
}

/** Primeira resposta do lead: replied nas inscrições ativas + hold de prospecção + interaction. */
async function marcarRespondeuSeForPrimeira(supabase: SupabaseClient, mb: BdrMailbox, leadId: string, inboundId: string) {
  const { data: ativos } = (await from(supabase, 'cadence_enrollments')
    .select('id, cadence_id').eq('lead_id', leadId).eq('status', 'active')) as { data: Array<{ id: string; cadence_id: string }> | null };

  await from(supabase, 'contact_holds')
    .upsert({ org_id: mb.org_id, lead_id: leadId, tipo: 'prospeccao', origem: 'email_replied' } as Record<string, unknown>, { onConflict: 'lead_id,tipo', ignoreDuplicates: true });

  if (!ativos?.length) return;
  await from(supabase, 'cadence_enrollments')
    .update({ status: 'replied', completed_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('lead_id', leadId).eq('status', 'active');
  for (const e of ativos) {
    await from(supabase, 'interactions').insert({
      org_id: mb.org_id, lead_id: leadId, cadence_id: e.cadence_id, channel: 'email', type: 'replied',
      metadata: { detected_by: 'bdr_inbox_ingest', inbound_id: inboundId, enrollment_id: e.id },
    } as Record<string, unknown>);
  }
  await from(supabase, 'leads').update({ status: 'contacted', contacted_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', leadId).eq('status', 'new');
}
