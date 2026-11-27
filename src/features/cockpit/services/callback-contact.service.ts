import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { normalizePhone } from '@/lib/utils/phone';

import { type RealConversationCall, isRealConversation } from '../utils/real-conversation';

/**
 * Contato do retorno VENCIDO de um lead (story cockpit-retorno-contato-indicado, B2). SOMENTE LEITURA, sempre filtrando
 * `org_id` (service role ignora RLS). Cartão e portão usam ESTA função: o número mostrado é o discado.
 *
 * Vale enquanto o retorno estiver PENDENTE e vencido e o indicado NÃO tiver atendido: tentativas sem conversa seguem
 * nele (a fila "consome" a prioridade, o número não). Depois de uma CONVERSA REAL com o contato (`isRealConversation`,
 * ligações com `calls.contact_id` = ele, a partir do `scheduled_at` do retorno) volta ao principal; um retorno novo, com
 * horário posterior, liga para ele de novo. Também sai quando o retorno é concluído, substituído ou expira.
 * `null` = discar o principal, como antes (sem contato, contato apagado, já atendeu ou erro de leitura).
 */
export interface CallbackTarget {
  contactId: string;
  name: string;
  jobTitle: string | null;
  /** `null` = o contato não tem telefone válido: liga-se para o principal. NUNCA vai para log. */
  phone: string | null;
}

type Rows<T> = { data: T[] | null; error: { message: string } | null };
type One<T> = { data: T | null; error: { message: string } | null };

/** Primeiro telefone com DDD (10 a 13 dígitos), a mesma régua do cadastro do indicado. */
export function pickContactPhone(phones: unknown): string | null {
  if (!Array.isArray(phones)) return null;
  for (const p of phones) {
    const raw = typeof p === 'string' ? p : (p as { numero?: unknown } | null)?.numero;
    if (typeof raw !== 'string') continue;
    const digits = normalizePhone(raw);
    if (digits.length >= 10 && digits.length <= 13) return raw.trim();
  }
  return null;
}

export async function loadCallbackTarget(input: {
  orgId: string;
  leadId: string;
  now: Date;
  /** Tarefa específica (Atividades): usa ESTE retorno pendente, mesmo que ainda não tenha vencido. */
  returnId?: string;
  /** Chamado quando o `null` veio de FALHA de leitura (e não de um motivo normal), para a tela poder avisar. */
  onError?: () => void;
  client?: SupabaseClient;
}): Promise<CallbackTarget | null> {
  const { orgId, leadId, now } = input;
  try {
    const client = input.client ?? createServiceRoleClient();
    const base = from(client, 'scheduled_activities')
      .select('contact_id, scheduled_at')
      .eq('org_id', orgId)
      .eq('lead_id', leadId)
      .eq('status', 'pending')
      .eq('channel', 'phone')
      .eq('kind', 'return');
    const returns = (await (input.returnId ? base.eq('id', input.returnId) : base.lte('scheduled_at', now.toISOString()))) as Rows<{
      contact_id: string | null;
      scheduled_at: string;
    }>;
    if (returns.error || !returns.data) {
      input.onError?.();
      console.error(
        '[callback-contact] retorno:',
        returns.error?.message ?? 'sem dados',
        'leadId=',
        leadId,
      );
      return null;
    }
    const due = returns.data
      .filter((r) => r.contact_id)
      .sort((a, b) => Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at))[0];
    const contactId = due?.contact_id;
    if (!due || !contactId) return null;

    // O indicado já atendeu este retorno? Na dúvida (erro) liga-se para o principal, nunca de novo para quem pode já ter falado.
    const talks = (await from(client, 'calls')
      .select('sdr_disposition, answered_at, duration_seconds, status, metadata')
      .eq('org_id', orgId)
      .eq('lead_id', leadId)
      .eq('contact_id', contactId)
      .gte('created_at', due.scheduled_at)) as Rows<RealConversationCall>;
    if (talks.error || !talks.data) {
      input.onError?.();
      console.error(
        '[callback-contact] ligações:',
        talks.error?.message ?? 'sem dados',
        'leadId=',
        leadId,
      );
      return null;
    }
    if (talks.data.some(isRealConversation)) return null;

    const contact = (await from(client, 'lead_contacts')
      .select('id, first_name, last_name, job_title, phones')
      .eq('id', contactId)
      .eq('lead_id', leadId)
      .eq('org_id', orgId)
      .maybeSingle()) as One<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      job_title: string | null;
      phones: unknown;
    }>;
    if (contact.error) {
      input.onError?.();
      console.error('[callback-contact] contato:', contact.error.message, 'leadId=', leadId);
    }
    const c = contact.data;
    if (!c) return null;
    return {
      contactId: c.id,
      name: [c.first_name, c.last_name].filter(Boolean).join(' ') || 'contato indicado',
      jobTitle: c.job_title,
      phone: pickContactPhone(c.phones),
    };
  } catch (err) {
    input.onError?.();
    console.error(
      '[callback-contact]:',
      err instanceof Error ? err.message : 'erro',
      'leadId=',
      leadId,
    );
    return null;
  }
}
