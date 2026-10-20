import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { escapeLikePattern } from '@/lib/utils/like';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';
import { createNotification } from '@/features/notifications/services/notification.service';

import {
  classifyInbound, extractEmailAddress, extractReferencedMessageIds, matchesOurThread, senderAuthVerdict, stripQuotedReply,
  type InboundKind, type OurSend,
} from '../services/inbound-classifier';
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
  /** Convites/aceites/recusas de agenda: gravados, nunca viram conversa. */
  agenda: number;
  /** E-mail de lead fora de thread nosso: gravado para auditoria, sem conversa. */
  avulsas: number;
  ignoradas: number;
  erros: string[];
}

/**
 * BDR-3 — Ingestão contínua da caixa do BDR IA (só caixas com `bdr_ai = true`),
 * independente da cadência. Cada mensagem tem identidade única (caixa +
 * gmail_message_id). Só vira conversa a mensagem de lead que CONTINUA um thread
 * que nós começamos (e-mail da cadência do BDR IA ou resposta do agente); essa
 * alimenta a conversa e dispara `email.replied` para o agente (n8n). A primeira
 * resposta marca as inscrições como replied e cria hold de prospecção — encerra
 * a prospecção fria, não a escuta. Agenda (`calendar`) e e-mail avulso
 * (`unrelated`) ficam só em `email_inbound`.
 */
export async function ingestEmailInbox(): Promise<{ success: boolean; data?: IngestResult; error?: string }> {
  const supabase = createServiceRoleClient();
  const out: IngestResult = { mailboxes: 0, novas: 0, conversas: 0, agenda: 0, avulsas: 0, ignoradas: 0, erros: [] };
  const mailboxes = await listBdrMailboxes(supabase);
  const ownEmails = mailboxes.map((m) => m.email_address.toLowerCase());
  const mailboxDomains = new Set(ownEmails.map((e) => e.split('@')[1]).filter((d): d is string => !!d));
  const domainsByOrg = new Map<string, Set<string>>();

  for (const mb of mailboxes) {
    out.mailboxes++;
    try {
      const ownDomains = await orgOwnDomains(supabase, mb.org_id, mailboxDomains, domainsByOrg);
      const r = await ingestMailbox(supabase, mb, ownEmails, ownDomains);
      out.novas += r.novas; out.conversas += r.conversas; out.ignoradas += r.ignoradas;
      out.agenda += r.agenda; out.avulsas += r.avulsas;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.erros.push(`${mb.email_address}: ${msg}`);
      console.error(`[inbox] ${mb.email_address} falhou:`, msg);
    }
  }
  return { success: true, data: out };
}

/**
 * Domínios da casa: os das caixas do BDR mais os de TODAS as conexões Gmail da
 * org (SDRs, closers, caixa antiga do piloto). Remetente daí é `own`, nunca lead
 * — foi assim que convites encaminhados por um colega viraram "conversa".
 * Mail entre contas do mesmo Workspace também chega sem Authentication-Results.
 */
async function orgOwnDomains(supabase: SupabaseClient, orgId: string, mailboxDomains: Set<string>, cache: Map<string, Set<string>>): Promise<Set<string>> {
  const cached = cache.get(orgId);
  if (cached) return cached;
  const set = new Set(mailboxDomains);
  const { data } = (await from(supabase, 'gmail_connections').select('email_address').eq('org_id', orgId)) as { data: Array<{ email_address: string | null }> | null };
  for (const c of data ?? []) {
    const d = c.email_address?.split('@')[1]?.toLowerCase();
    if (d) set.add(d);
  }
  cache.set(orgId, set);
  return set;
}

/**
 * Envios nossos que uma mensagem pode estar continuando: e-mails de cadência
 * com executor `bdr_ai` (casam por thread_id do Gmail ou por rfc_message_id) e
 * respostas do agente (`email_reply_intents`, Message-ID gerado antes do envio).
 */
async function findOurSends(supabase: SupabaseClient, orgId: string, threadId: string | null, refIds: string[]): Promise<OurSend[]> {
  const out: OurSend[] = [];
  type SentRow = { metadata: Record<string, unknown> | null };
  const cadenceSends = () => from(supabase, 'interactions')
    .select('metadata, cadences!inner(executor)')
    .eq('org_id', orgId).eq('channel', 'email').eq('type', 'sent').eq('cadences.executor', 'bdr_ai');
  const push = (rows: SentRow[] | null) => {
    for (const r of rows ?? []) {
      out.push({ thread_id: r.metadata?.thread_id as string | undefined, rfc_message_id: r.metadata?.rfc_message_id as string | undefined });
    }
  };
  if (threadId) {
    const { data } = (await cadenceSends().eq('metadata->>thread_id', threadId).limit(5)) as { data: SentRow[] | null };
    push(data);
  }
  if (refIds.length) {
    const { data } = (await cadenceSends().in('metadata->>rfc_message_id', refIds).limit(5)) as { data: SentRow[] | null };
    push(data);
    const { data: intents } = (await from(supabase, 'email_reply_intents')
      .select('rfc_message_id').eq('org_id', orgId).in('rfc_message_id', refIds).limit(5)) as { data: Array<{ rfc_message_id: string }> | null };
    for (const i of intents ?? []) out.push({ rfc_message_id: i.rfc_message_id });
  }
  return out;
}

async function ingestMailbox(supabase: SupabaseClient, mb: BdrMailbox, ownEmails: string[], ownDomains: Set<string>) {
  const res = { novas: 0, conversas: 0, agenda: 0, avulsas: 0, ignoradas: 0 };
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

    const kind = classifyInbound({
      headers: msg.headers, ownEmails, ownDomains: [...ownDomains], isKnownLeadSender: Boolean(existingConv),
      mimeType: msg.mimeType, partMimeTypes: msg.partMimeTypes, attachmentNames: msg.attachmentNames,
    });

    // Remetente autenticado (SPF/DKIM/DMARC do próprio Gmail)? Sem isso, um
    // e-mail com From forjado se passava pelo lead, parava a cadência e chegava
    // ao agente de IA. Falha explícita nunca conta como lead; para casar um lead
    // NOVO pelo From (sem conversa na thread) é preciso aprovação.
    const auth = senderAuthVerdict(msg.authResults, fromEmail);
    const internal = auth === 'unknown' && !!fromEmail && ownDomains.has(fromEmail.split('@')[1] ?? '');
    const authOk = auth === 'pass' || internal || (Boolean(existingConv) && auth === 'unknown');

    // Lead: pelo e-mail do remetente (na org) ou pela conversa da thread
    let leadId: string | null = existingConv?.lead_id ?? null;
    if (!leadId && kind === 'lead' && fromEmail && authOk) {
      // Igualdade case-insensitive: sem escapar, `%`/`_` do remetente viravam
      // curingas e um From como "%@%.%" casava qualquer lead da org.
      const { data: lead } = (await from(supabase, 'leads').select('id').eq('org_id', mb.org_id).ilike('email', escapeLikePattern(fromEmail)).is('deleted_at', null).limit(1).maybeSingle()) as { data: { id: string } | null };
      leadId = lead?.id ?? null;
    }
    if (kind === 'lead' && !authOk) {
      console.warn(`[inbox] ${mb.email_address}: remetente ${fromEmail ?? '?'} sem autenticação (${auth}) — não tratado como lead (msg ${msg.id})`);
      await notifyUnverifiedReply(supabase, mb, fromEmail, existingConv?.lead_id ?? null);
    }

    // Só vira conversa quem continua um thread que NÓS começamos. Lead que
    // escreve do nada (proposta, reunião marcada por outro canal) fica só em
    // email_inbound como `unrelated`: sem conversa, sem replied, sem agente.
    let continuaNossoThread = Boolean(existingConv);
    if (!continuaNossoThread && kind === 'lead' && leadId && authOk) {
      const sends = await findOurSends(supabase, mb.org_id, msg.threadId, extractReferencedMessageIds(msg.headers));
      continuaNossoThread = matchesOurThread({ threadId: msg.threadId, headers: msg.headers }, sends);
    }
    const finalKind: InboundKind = kind !== 'lead' ? kind
      : !leadId || !authOk ? 'unknown'
      : !continuaNossoThread ? 'unrelated'
      : 'lead';
    if (finalKind === 'calendar') res.agenda++;
    if (finalKind === 'unrelated') res.avulsas++;

    const { data: inserted } = (await from(supabase, 'email_inbound')
      .insert({
        org_id: mb.org_id, mailbox_user_id: mb.user_id, gmail_message_id: msg.id, thread_id: msg.threadId,
        rfc_message_id: msg.headers['message-id'] ?? null, in_reply_to: msg.headers['in-reply-to'] ?? null,
        from_email: fromEmail, subject: msg.headers['subject'] ?? null, snippet: msg.snippet.slice(0, 500),
        body_text: stripQuotedReply(msg.text).slice(0, 20000), internal_date: msg.internalDate.toISOString(),
        // agenda nunca alimenta conversa, nem a já existente na thread
        kind: finalKind, lead_id: leadId, conversation_id: finalKind === 'calendar' ? null : (existingConv?.id ?? null),
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

/**
 * A message that looks like a lead's reply but failed sender authentication is
 * not handed to the AI agent (could be forged). It may still be a real reply
 * from a badly configured domain, so the lead's owner is told to check the
 * inbox — generic text only, never the (untrusted) content.
 */
async function notifyUnverifiedReply(supabase: SupabaseClient, mb: BdrMailbox, fromEmail: string | null, convLeadId: string | null) {
  try {
    let leadId = convLeadId;
    if (!leadId && fromEmail) {
      const { data } = (await from(supabase, 'leads').select('id').eq('org_id', mb.org_id).ilike('email', escapeLikePattern(fromEmail)).is('deleted_at', null).limit(1).maybeSingle()) as { data: { id: string } | null };
      leadId = data?.id ?? null;
    }
    if (!leadId) return;
    const { data: lead } = (await from(supabase, 'leads').select('assigned_to, nome_fantasia, razao_social').eq('id', leadId).maybeSingle()) as { data: { assigned_to: string | null; nome_fantasia: string | null; razao_social: string | null } | null };
    if (!lead?.assigned_to) return;
    await createNotification({
      org_id: mb.org_id,
      user_id: lead.assigned_to,
      type: 'integration_error',
      title: `Resposta não verificada: ${lead.nome_fantasia || lead.razao_social || fromEmail || 'lead'}`,
      body: `Chegou na caixa ${mb.email_address} um e-mail em nome deste lead que não passou na verificação do remetente, então o BDR IA não respondeu. Confira na caixa se é do lead mesmo.`,
      resource_type: 'lead',
      resource_id: leadId,
      metadata: { mailbox: mb.email_address, from_email: fromEmail, reason: 'sender_auth_failed' },
    });
  } catch (err) {
    console.error('[inbox] falha ao avisar resposta não verificada:', err);
  }
}
