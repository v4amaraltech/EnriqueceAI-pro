import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { resolveUserProfiles } from '@/lib/auth/user-directory';

import type { AutoDialLeadCardExtras } from '../auto-dial.types';

/**
 * Contexto extra do cartão do motor (FR-24, A-D7): origem, datas, motivo e notas da perda e o "Último SDR que ligou".
 * SOMENTE LEITURA. Service role ignora RLS, então TODA consulta filtra `org_id` (um lead de outra organização nunca
 * aparece). Falha de leitura NÃO bloqueia a ligação: devolve `null` e o painel mostra o cartão sem os extras.
 */

type One<T> = { data: T | null; error: { message: string } | null };
type Rows<T> = { data: T[] | null; error: { message: string } | null };

interface LeadExtrasRow {
  lead_source: string | null;
  canal: string | null;
  created_at: string | null;
  lost_at: string | null;
  loss_reason_id: string | null;
  loss_notes: string | null;
}

export async function loadLeadCardExtras(input: {
  client: SupabaseClient;
  orgId: string;
  leadId: string;
  /** O usuário que está ligando agora: o "SDR antigo" é OUTRO usuário. */
  currentUserId: string;
}): Promise<AutoDialLeadCardExtras | null> {
  const { client, orgId, leadId, currentUserId } = input;
  try {
    const leadRes = (await from(client, 'leads')
      .select('lead_source, canal, created_at, lost_at, loss_reason_id, loss_notes')
      .eq('id', leadId)
      .eq('org_id', orgId)
      .maybeSingle()) as One<LeadExtrasRow>;
    if (leadRes.error || !leadRes.data) return null;
    const lead = leadRes.data;

    let lossReasonName: string | null = null;
    if (lead.loss_reason_id) {
      const reason = (await from(client, 'loss_reasons')
        .select('name')
        .eq('id', lead.loss_reason_id)
        .eq('org_id', orgId)
        .maybeSingle()) as One<{ name: string | null }>;
      if (!reason.error) lossReasonName = reason.data?.name ?? null;
    }

    // Notas da perda: as do lead; senão as da inscrição de cadência mais recente que tiver.
    let lossNotes = lead.loss_notes?.trim() ? lead.loss_notes : null;
    if (!lossNotes && lead.lost_at) {
      const enr = (await from(client, 'cadence_enrollments')
        .select('loss_notes, completed_at')
        .eq('org_id', orgId)
        .eq('lead_id', leadId)
        .not('loss_notes', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(5)) as Rows<{ loss_notes: string | null; completed_at: string | null }>;
      lossNotes = enr.data?.find((e) => e.loss_notes?.trim())?.loss_notes ?? null;
    }

    // A-D7: último usuário que ligou para o lead e NÃO é quem está ligando agora (não há histórico de dono no produto).
    let previousSdr: AutoDialLeadCardExtras['previousSdr'] = null;
    const last = (await from(client, 'calls')
      .select('user_id, created_at')
      .eq('org_id', orgId)
      .eq('lead_id', leadId)
      .neq('user_id', currentUserId)
      .order('created_at', { ascending: false })
      .limit(1)) as Rows<{ user_id: string | null; created_at: string }>;
    const prevId = last.data?.find((c) => c.user_id)?.user_id ?? null;
    if (prevId) {
      const profiles = await resolveUserProfiles([prevId]);
      previousSdr = { userId: prevId, name: profiles.get(prevId)?.displayName ?? prevId.slice(0, 8) };
    }

    return {
      leadSource: lead.lead_source,
      canal: lead.canal,
      createdAt: lead.created_at,
      lostAt: lead.lost_at,
      lossReasonName,
      lossNotes,
      previousSdr,
    };
  } catch (err) {
    console.error('[cockpit-auto-dial] extras:', err instanceof Error ? err.message : 'erro');
    return null;
  }
}
