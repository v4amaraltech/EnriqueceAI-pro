import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { EmailService } from '@/features/integrations/services/email.service';
import { classifyGmailSendResult } from '@/features/email-conversations/services/inbound-classifier';
import { isUuid } from '@/shared/utils/uuid';

const DEFAULT_LEASE_S = 300;
const DEFAULT_DAILY_CAP = 80;
const ACTIONS = new Set(['claim', 'renew', 'release', 'reply', 'handoff', 'resume', 'close']);

type Conv = {
  id: string; org_id: string; lead_id: string; mailbox_user_id: string; thread_id: string;
  estado: string; lock_owner: string | null; lock_until: string | null;
};

/**
 * BDR-3 — Ações do executor (n8n) sobre uma conversa:
 *   claim   {owner, lease_seconds?}      lock atômico (RPC); 409 se outro dono
 *   renew   {owner}                      heartbeat; 409 se perdeu o lock
 *   release {owner}
 *   reply   {owner, html, subject?, responde_a?: uuid[]}  intenção antes do envio; erro classificado
 *   handoff {user_id?, motivo?}          humano assume (hold 'conversa'); IA para
 *   resume  {}                           humano devolve à IA
 *   close   {}
 * POST /api/v1/email-conversations/{id}/{action}
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`inbound-api:${auth.orgId}`, 100, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });

  const { id, action } = await params;
  if (!isUuid(id) || !ACTIONS.has(action)) return NextResponse.json({ success: false, error: 'id ou ação inválidos' }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const supabase = createServiceRoleClient();
  const { data: conv } = (await from(supabase, 'email_conversations').select('*').eq('id', id).eq('org_id', auth.orgId).maybeSingle()) as { data: Conv | null };
  if (!conv) return NextResponse.json({ success: false, error: 'Conversa não encontrada' }, { status: 404 });

  const owner = typeof body.owner === 'string' ? body.owner : null;
  const lease = Number(body.lease_seconds ?? DEFAULT_LEASE_S);

  try {
    switch (action) {
      case 'claim': {
        if (!owner) return bad('owner obrigatório');
        const { data: ok } = await supabase.rpc('claim_email_conversation' as never, { p_id: id, p_owner: owner, p_lease_seconds: lease } as never);
        if (!ok) return NextResponse.json({ success: false, error: 'Conversa em execução por outro executor', code: 'lock_ocupado' }, { status: 409 });
        return NextResponse.json({ success: true, data: { owner, lock_until: new Date(Date.now() + lease * 1000).toISOString(), estado: conv.estado } });
      }
      case 'renew': {
        if (!owner) return bad('owner obrigatório');
        const { data: ok } = await supabase.rpc('renew_email_conversation_lock' as never, { p_id: id, p_owner: owner, p_lease_seconds: lease } as never);
        if (!ok) return NextResponse.json({ success: false, error: 'Lock perdido: outro executor assumiu; não envie', code: 'lock_perdido' }, { status: 409 });
        return NextResponse.json({ success: true });
      }
      case 'release': {
        if (!owner) return bad('owner obrigatório');
        await supabase.rpc('release_email_conversation_lock' as never, { p_id: id, p_owner: owner } as never);
        return NextResponse.json({ success: true });
      }
      case 'handoff': {
        await from(supabase, 'email_conversations').update({ estado: 'humano_assumiu', humano_user_id: (body.user_id as string) ?? null } as Record<string, unknown>).eq('id', id);
        await from(supabase, 'contact_holds').upsert({ org_id: conv.org_id, lead_id: conv.lead_id, tipo: 'conversa', origem: `handoff:${(body.motivo as string) ?? 'agente'}` } as Record<string, unknown>, { onConflict: 'lead_id,tipo', ignoreDuplicates: true });
        return NextResponse.json({ success: true, data: { estado: 'humano_assumiu' } });
      }
      case 'resume': {
        await from(supabase, 'email_conversations').update({ estado: 'ia_ativa', humano_user_id: null, trocas_sem_avanco: 0 } as Record<string, unknown>).eq('id', id);
        await from(supabase, 'contact_holds').delete().eq('lead_id', conv.lead_id).eq('tipo', 'conversa');
        return NextResponse.json({ success: true, data: { estado: 'ia_ativa' } });
      }
      case 'close': {
        await from(supabase, 'email_conversations').update({ estado: 'encerrada', lock_owner: null, lock_until: null } as Record<string, unknown>).eq('id', id);
        return NextResponse.json({ success: true, data: { estado: 'encerrada' } });
      }
      case 'reply':
        return reply(supabase, conv, owner, body);
    }
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  return bad('ação desconhecida');
}

function bad(msg: string) {
  return NextResponse.json({ success: false, error: msg }, { status: 400 });
}

async function reply(supabase: ReturnType<typeof createServiceRoleClient>, conv: Conv, owner: string | null, body: Record<string, unknown>) {
  const html = typeof body.html === 'string' ? body.html.trim() : '';
  if (!owner) return bad('owner obrigatório');
  if (!html) return bad('html obrigatório');

  // Só o dono do lock, com lock vivo, envia
  if (conv.lock_owner !== owner || !conv.lock_until || new Date(conv.lock_until) < new Date()) {
    return NextResponse.json({ success: false, error: 'Executor não é dono do lock (ou lock expirou): não envie', code: 'lock_perdido' }, { status: 409 });
  }
  if (conv.estado !== 'ia_ativa') {
    return NextResponse.json({ success: false, error: `Conversa em estado '${conv.estado}': IA não responde`, code: 'ia_parada' }, { status: 409 });
  }
  // Bloqueios no momento do envio (fonte central)
  const { data: holds } = (await from(supabase, 'contact_holds').select('tipo').eq('lead_id', conv.lead_id).in('tipo', ['conversa', 'total'])) as { data: Array<{ tipo: string }> | null };
  if (holds?.length) return NextResponse.json({ success: false, error: `Lead com bloqueio '${holds[0]?.tipo ?? '?'}'`, code: 'bloqueado' }, { status: 409 });
  const { data: sup } = (await from(supabase, 'leads').select('email, email_bounced_at').eq('id', conv.lead_id).maybeSingle()) as { data: { email: string | null; email_bounced_at: string | null } | null };
  if (!sup?.email) return bad('lead sem e-mail');
  if (sup.email_bounced_at) return NextResponse.json({ success: false, error: 'E-mail do lead com bounce', code: 'bloqueado' }, { status: 409 });
  const { data: suppressed } = (await from(supabase, 'email_suppressions').select('id').eq('org_id', conv.org_id).ilike('email', sup.email).limit(1).maybeSingle()) as { data: { id: string } | null };
  if (suppressed) return NextResponse.json({ success: false, error: 'E-mail suprimido (descadastro)', code: 'bloqueado' }, { status: 409 });

  // Teto diário da caixa (respostas do agente contam)
  const { data: mb } = (await from(supabase, 'gmail_connections').select('email_address, daily_cap, paused_reason').eq('user_id', conv.mailbox_user_id).eq('org_id', conv.org_id).maybeSingle()) as { data: { email_address: string; daily_cap: number | null; paused_reason: string | null } | null };
  if (!mb) return bad('caixa do BDR não encontrada');
  if (mb.paused_reason) return NextResponse.json({ success: false, error: `Caixa pausada: ${mb.paused_reason}`, code: 'caixa_pausada' }, { status: 429 });
  const inicioDia = new Date(); inicioDia.setUTCHours(3, 0, 0, 0); // 00:00 BRT
  const { count: hojeCaixa } = await from(supabase, 'interactions').select('id', { count: 'exact', head: true }).eq('org_id', conv.org_id).eq('performed_by', conv.mailbox_user_id).eq('channel', 'email').eq('type', 'sent').gte('created_at', inicioDia.toISOString()) as unknown as { count: number | null };
  if ((hojeCaixa ?? 0) >= (mb.daily_cap ?? DEFAULT_DAILY_CAP)) {
    return NextResponse.json({ success: false, error: 'Teto diário da caixa atingido', code: 'teto_caixa' }, { status: 429 });
  }

  // Última mensagem do lead na thread → In-Reply-To; assunto herdado
  const { data: ultima } = (await from(supabase, 'email_inbound').select('id, rfc_message_id, subject').eq('conversation_id', conv.id).eq('kind', 'lead').order('internal_date', { ascending: false }).limit(1).maybeSingle()) as { data: { id: string; rfc_message_id: string | null; subject: string | null } | null };
  const respondeA = Array.isArray(body.responde_a) ? (body.responde_a as string[]).filter(isUuid) : ultima ? [ultima.id] : [];
  const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : (ultima?.subject?.startsWith('Re:') ? ultima.subject : `Re: ${ultima?.subject ?? ''}`.trim());

  // Intenção persistente com Message-ID gerado ANTES do envio
  const domain = mb.email_address.split('@')[1] ?? 'enriqueceai.com.br';
  const rfcMessageId = `<bdr-${randomUUID()}@${domain}>`;
  const { data: intent } = (await from(supabase, 'email_reply_intents')
    .insert({ org_id: conv.org_id, conversation_id: conv.id, responde_a: respondeA, rfc_message_id: rfcMessageId, estado: 'enviando', subject, body_html: html, owner } as Record<string, unknown>)
    .select('id').maybeSingle()) as { data: { id: string } | null };
  if (!intent) return NextResponse.json({ success: false, error: 'Não foi possível registrar a intenção' }, { status: 500 });

  let r: Awaited<ReturnType<typeof EmailService.sendEmail>>;
  try {
    r = await EmailService.sendEmail(conv.mailbox_user_id, conv.org_id, {
      to: sup.email, subject, htmlBody: html, threadId: conv.thread_id,
      inReplyToMessageId: ultima?.rfc_message_id ?? undefined, messageId: rfcMessageId, leadId: conv.lead_id,
    }, undefined, supabase);
  } catch (e) {
    // Sem resposta do Gmail (timeout/rede): a mensagem PODE ter saído
    r = { success: false, stage: 'network', error: e instanceof Error ? e.message : String(e) };
  }
  const outcome = classifyGmailSendResult(r);

  if (outcome === 'enviada') {
    await from(supabase, 'email_reply_intents').update({ estado: 'enviada', gmail_message_id: r.messageId ?? null, tentativas: 1 } as Record<string, unknown>).eq('id', intent.id);
    await from(supabase, 'email_conversations').update({ estado: 'aguardando_lead', ultima_msg_ia_at: new Date().toISOString() } as Record<string, unknown>).eq('id', conv.id);
    await from(supabase, 'interactions').insert({
      org_id: conv.org_id, lead_id: conv.lead_id, channel: 'email', type: 'sent', message_content: html,
      external_id: r.messageId ?? null, performed_by: conv.mailbox_user_id, ai_generated: true,
      metadata: { source: 'bdr_email_agent', conversation_id: conv.id, intent_id: intent.id, rfc_message_id: rfcMessageId, thread_id: r.threadId ?? conv.thread_id },
    } as Record<string, unknown>);
    return NextResponse.json({ success: true, data: { intent_id: intent.id, estado: 'enviada', gmail_message_id: r.messageId ?? null } });
  }
  await from(supabase, 'email_reply_intents').update({ estado: outcome, erro: `${r.stage ?? '?'} ${r.httpStatus ?? ''} ${r.error ?? ''}`.trim(), tentativas: 1 } as Record<string, unknown>).eq('id', intent.id);
  const status = outcome === 'falhou' ? 502 : 503;
  return NextResponse.json({
    success: false, code: outcome === 'falhou' ? 'envio_falhou' : 'envio_incerto',
    error: outcome === 'falhou'
      ? `Gmail rejeitou antes do aceite (${r.httpStatus ?? '?'}): ${r.error ?? ''} — pode tentar de novo com a mesma intenção`
      : `Resultado desconhecido (${r.error ?? 'sem resposta'}) — intenção ${intent.id} em conciliação; NÃO reenvie`,
    data: { intent_id: intent.id, estado: outcome },
  }, { status });
}
