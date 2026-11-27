import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { isUuid } from '@/lib/utils/uuid';

/**
 * Contato (`lead_contacts`) de um retorno. Sem sessão própria: quem chama passa o client e o `orgId`.
 * Nada aqui lança: falha = retorno sem contato (o retorno nunca pode se perder por causa do contato).
 */

type One<T> = { data: T | null; error: { message: string } | null };

/** O contato só vale se for deste lead e desta org; senão o retorno segue sem ele. */
export async function resolveReturnContactId(
  client: SupabaseClient,
  orgId: string,
  leadId: string,
  contactId: string,
): Promise<string | null> {
  try {
    if (isUuid(contactId)) {
      const { data, error } = (await from(client, 'lead_contacts')
        .select('id')
        .eq('id', contactId)
        .eq('lead_id', leadId)
        .eq('org_id', orgId)
        .maybeSingle()) as One<{ id: string }>;
      if (data) return data.id;
      if (error) console.warn('[return-contact] check failed:', error.message, 'leadId=', leadId);
    }
    console.warn(
      '[return-contact] return saved without contact (not found for this lead). leadId=',
      leadId,
    );
  } catch (err) {
    console.warn(
      '[return-contact] check failed:',
      err instanceof Error ? err.message : 'erro',
      'leadId=',
      leadId,
    );
  }
  return null;
}

/**
 * Herança: contato do retorno de LIGAÇÃO ainda pendente que o novo vai substituir. Chamar ANTES do insert/cancelamento.
 * Retorno concluído, cancelado ou expirado não conta. Revalida lead + org.
 */
export async function inheritReturnContactId(
  client: SupabaseClient,
  orgId: string,
  leadId: string,
): Promise<string | null> {
  try {
    const { data, error } = (await from(client, 'scheduled_activities')
      .select('contact_id')
      .eq('org_id', orgId)
      .eq('lead_id', leadId)
      .eq('status', 'pending')
      .eq('channel', 'phone')
      .eq('kind', 'return')
      .not('contact_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()) as One<{ contact_id: string | null }>;
    if (error)
      console.warn('[return-contact] inherit read failed:', error.message, 'leadId=', leadId);
    return data?.contact_id
      ? await resolveReturnContactId(client, orgId, leadId, data.contact_id)
      : null;
  } catch (err) {
    console.warn(
      '[return-contact] inherit failed:',
      err instanceof Error ? err.message : 'erro',
      'leadId=',
      leadId,
    );
    return null;
  }
}
