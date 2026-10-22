'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { logLeadEvent } from '@/features/leads/actions/log-lead-event';

import {
  FOLLOWUP_MAX_PER_ORG,
  type FollowupKind,
  buildFollowupNote,
  businessDaysSince,
  minBusinessDaysFor,
  todayAt9hBrt,
} from '../services/paused-cadence-followup.logic';

interface LimboLead {
  id: string;
  org_id: string;
  assigned_to: string | null;
}

interface EnrollmentRow {
  lead_id: string;
  status: string;
  scheduled_start_at: string | null;
  cadence: { name: string } | null;
}

interface LeadFollowup {
  kind: FollowupKind;
  cadenceNames: string[];
}

/** Lista de ids por chamada `.in()` — evita estourar a URL do PostgREST. */
const ID_CHUNK = 100;

const KIND_PRIORITY: Record<FollowupKind, number> = { paused: 0, bounced: 1, replied: 2 };

/**
 * Cadência pausada SEM data de volta (bounce, "Não é WhatsApp", erro de envio,
 * pausa manual) não volta sozinha: fica fora da fila, do auto-perda e do motor,
 * e o lead fica "Contatado" sem próxima atividade (limbo). O mesmo vale para a
 * inscrição que terminou em `bounced` ou `replied`: a auto-perda só olha
 * `completed`, então nada tira o lead dali.
 *
 * Roda antes do alerta diário de limbo: para cada lead do limbo que tem dono e
 * cadência pausada sem `scheduled_start_at` (ou última inscrição `bounced`/
 * `replied`), cria uma tarefa "Definir destino" na fila do SDR — após 3+ dias
 * úteis sem contato; se o lead respondeu, no mesmo dia. A tarefa pendente já tira o lead
 * da view `v_leads_cadence_limbo`; o alerta aos gestores fica com o resto
 * (lead sem dono, pausa recente).
 *
 * O evento `paused_cadence_followup` gravado na timeline é uma interação: se o
 * SDR concluir a tarefa sem resolver, a próxima só sai 3 dias úteis depois.
 */
export async function createPausedCadenceFollowups(
  now: Date = new Date(),
): Promise<ActionResult<{ candidates: number; created: number }>> {
  const supabase = createServiceRoleClient();

  const { data: limbo, error } = (await from(supabase, 'v_leads_cadence_limbo' as never)
    .select('id, org_id, assigned_to')
    .not('assigned_to', 'is', null)) as { data: LimboLead[] | null; error: { message: string } | null };

  if (error) {
    console.error('[paused-followup] Failed to fetch limbo leads:', error.message);
    return { success: false, error: error.message };
  }
  if (!limbo?.length) return { success: true, data: { candidates: 0, created: 0 } };

  // Só entra quem tem cadência PAUSADA sem data de volta, ou cuja inscrição
  // mais recente terminou em bounce/resposta (inscrição antiga com bounce e
  // depois concluída é caso da auto-perda, não daqui).
  const followupByLead = new Map<string, LeadFollowup>();
  for (let i = 0; i < limbo.length; i += ID_CHUNK) {
    const ids = limbo.slice(i, i + ID_CHUNK).map((l) => l.id);
    const { data: rows } = (await from(supabase, 'cadence_enrollments')
      .select('lead_id, status, scheduled_start_at, cadence:cadences(name)')
      .in('lead_id', ids)
      .order('enrolled_at', { ascending: false })) as { data: EnrollmentRow[] | null };

    // Linhas vêm da mais recente para a mais antiga.
    const latestByLead = new Map<string, EnrollmentRow>();
    for (const row of rows ?? []) {
      if (!latestByLead.has(row.lead_id)) latestByLead.set(row.lead_id, row);
    }

    for (const row of rows ?? []) {
      let kind: FollowupKind | null = null;
      if (row.status === 'paused' && !row.scheduled_start_at) kind = 'paused';
      else if ((row.status === 'bounced' || row.status === 'replied') && latestByLead.get(row.lead_id) === row) {
        kind = row.status;
      }
      if (!kind) continue;

      // Prioridade do texto/prazo: respondeu > bounce > pausada. A nota cita só
      // as cadências do motivo que venceu.
      const current = followupByLead.get(row.lead_id);
      if (current && KIND_PRIORITY[current.kind] > KIND_PRIORITY[kind]) continue;
      const names = current?.kind === kind ? current.cadenceNames : [];
      if (row.cadence?.name && !names.includes(row.cadence.name)) names.push(row.cadence.name);
      followupByLead.set(row.lead_id, { kind, cadenceNames: names });
    }
  }

  const candidates = limbo.filter((l) => followupByLead.has(l.id));
  const createdByOrg = new Map<string, number>();
  const scheduledAt = todayAt9hBrt(now);
  let created = 0;

  for (const lead of candidates) {
    if ((createdByOrg.get(lead.org_id) ?? 0) >= FOLLOWUP_MAX_PER_ORG) continue;
    try {
      const { data: last } = (await from(supabase, 'interactions')
        .select('created_at')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(1)) as { data: Array<{ created_at: string }> | null };
      const followup = followupByLead.get(lead.id);
      if (!followup) continue;
      const lastContact = last?.[0]?.created_at;
      if (lastContact && businessDaysSince(new Date(lastContact), now) < minBusinessDaysFor(followup.kind)) continue;

      const { data: pauseEvent } = (await from(supabase, 'interactions')
        .select('metadata')
        .eq('lead_id', lead.id)
        .eq('channel', 'system')
        .contains('metadata', { system_event: 'cadence_paused' })
        .order('created_at', { ascending: false })
        .limit(1)) as { data: Array<{ metadata: { reason?: string } | null }> | null };

      const { kind, cadenceNames } = followup;
      const notes = buildFollowupNote(kind, cadenceNames, pauseEvent?.[0]?.metadata?.reason);

      const { error: insertError } = await from(supabase, 'scheduled_activities' as never)
        .insert({
          org_id: lead.org_id,
          lead_id: lead.id,
          user_id: lead.assigned_to,
          channel: 'research',
          scheduled_at: scheduledAt,
          notes,
        } as never);
      if (insertError) {
        console.error(`[paused-followup] lead=${lead.id} falha ao criar tarefa:`, insertError.message);
        continue;
      }

      await logLeadEvent(supabase, {
        orgId: lead.org_id,
        leadId: lead.id,
        userId: null,
        event: 'paused_cadence_followup',
        message: notes,
        metadata: { kind, cadences: cadenceNames, assigned_to: lead.assigned_to },
      });

      createdByOrg.set(lead.org_id, (createdByOrg.get(lead.org_id) ?? 0) + 1);
      created++;
    } catch (err) {
      console.error(`[paused-followup] lead=${lead.id} erro inesperado:`, err);
    }
  }

  console.warn(`[paused-followup] Complete: candidates=${candidates.length} created=${created}`);
  return { success: true, data: { candidates: candidates.length, created } };
}
