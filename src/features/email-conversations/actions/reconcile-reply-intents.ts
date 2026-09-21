import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { findMessageByRfcId, getMailboxAccessToken, type BdrMailbox } from '../services/gmail-inbox.service';

const ALERT_AFTER_MS = 24 * 3600 * 1000;

/**
 * BDR-3 — Conciliação de intenções `incerta`: procura pelo Message-ID gerado
 * antes do envio. Achou → enviada. Não achou → continua incerta (busca vazia
 * não prova rejeição); após 24h, alerta. Nunca reenvia.
 */
export async function reconcileReplyIntents(): Promise<{ success: boolean; data?: { verificadas: number; confirmadas: number; alertas: number }; error?: string }> {
  const supabase = createServiceRoleClient();
  const out = { verificadas: 0, confirmadas: 0, alertas: 0 };

  const { data: intents } = (await from(supabase, 'email_reply_intents')
    .select('id, conversation_id, rfc_message_id, created_at, tentativas')
    .eq('estado', 'incerta').limit(100)) as { data: Array<{ id: string; conversation_id: string; rfc_message_id: string; created_at: string; tentativas: number }> | null };
  if (!intents?.length) return { success: true, data: out };

  const tokenCache = new Map<string, string | null>();
  for (const it of intents) {
    out.verificadas++;
    const { data: conv } = (await from(supabase, 'email_conversations').select('mailbox_user_id, org_id').eq('id', it.conversation_id).maybeSingle()) as { data: { mailbox_user_id: string; org_id: string } | null };
    if (!conv) continue;
    let token = tokenCache.get(conv.mailbox_user_id);
    if (token === undefined) {
      const { data: mb } = (await from(supabase, 'gmail_connections').select('*').eq('user_id', conv.mailbox_user_id).eq('org_id', conv.org_id).in('status', ['connected', 'error']).maybeSingle()) as { data: BdrMailbox | null };
      token = mb ? await getMailboxAccessToken(supabase, mb) : null;
      tokenCache.set(conv.mailbox_user_id, token);
    }
    if (!token) continue;
    try {
      const gmailId = await findMessageByRfcId(token, it.rfc_message_id);
      if (gmailId) {
        await from(supabase, 'email_reply_intents').update({ estado: 'enviada', gmail_message_id: gmailId, erro: null } as Record<string, unknown>).eq('id', it.id);
        await from(supabase, 'email_conversations').update({ ultima_msg_ia_at: new Date().toISOString(), estado: 'aguardando_lead' } as Record<string, unknown>).eq('id', it.conversation_id).eq('estado', 'ia_ativa');
        out.confirmadas++;
        continue;
      }
      const tentativas = it.tentativas + 1;
      await from(supabase, 'email_reply_intents').update({ tentativas } as Record<string, unknown>).eq('id', it.id);
      if (Date.now() - new Date(it.created_at).getTime() > ALERT_AFTER_MS) {
        out.alertas++;
        console.error(`[reply-intents] ALERTA intenção ${it.id} incerta há mais de 24h (Message-ID ${it.rfc_message_id}) — decisão humana necessária; sem reenvio automático`);
      }
    } catch (e) {
      console.error(`[reply-intents] conciliação de ${it.id} falhou:`, e instanceof Error ? e.message : e);
    }
  }
  return { success: true, data: out };
}
