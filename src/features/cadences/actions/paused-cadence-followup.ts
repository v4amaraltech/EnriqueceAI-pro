'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { logLeadEvent } from '@/features/leads/actions/log-lead-event';

import {
  FOLLOWUP_MAX_PER_ORG,
  FOLLOWUP_MIN_BUSINESS_DAYS,
  buildFollowupNote,
  businessDaysSince,
  todayAt9hBrt,
} from '../services/paused-cadence-followup.logic';

interface LimboLead {
  id: string;
  org_id: string;
  assigned_to: string | null;
}

interface PausedEnrollment {
  lead_id: string;
  cadence: { name: string } | null;
}

/** Lista de ids por chamada `.in()` — evita estourar a URL do PostgREST. */
const ID_CHUNK = 100;

/**
 * Cadência pausada SEM data de volta (bounce, "Não é WhatsApp", erro de envio,
 * pausa manual) não volta sozinha: fica fora da fila, do auto-perda e do motor,
 * e o lead fica "Contatado" sem próxima atividade (limbo).
 *
 * Roda antes do alerta diário de limbo: para cada lead do limbo que tem dono,
 * cadência pausada sem `scheduled_start_at` e 3+ dias úteis sem contato, cria
 * uma tarefa "Definir destino" na fila do SDR. A tarefa pendente já tira o lead
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

  // Só entra quem tem cadência PAUSADA sem data de volta.
  const cadencesByLead = new Map<string, string[]>();
  for (let i = 0; i < limbo.length; i += ID_CHUNK) {
    const ids = limbo.slice(i, i + ID_CHUNK).map((l) => l.id);
    const { data: paused } = (await from(supabase, 'cadence_enrollments')
      .select('lead_id, cadence:cadences(name)')
      .in('lead_id', ids)
      .eq('status', 'paused')
      .is('scheduled_start_at', null)) as { data: PausedEnrollment[] | null };
    for (const row of paused ?? []) {
      const names = cadencesByLead.get(row.lead_id) ?? [];
      if (row.cadence?.name && !names.includes(row.cadence.name)) names.push(row.cadence.name);
      cadencesByLead.set(row.lead_id, names);
    }
  }

  const candidates = limbo.filter((l) => cadencesByLead.has(l.id));
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
      const lastContact = last?.[0]?.created_at;
      if (lastContact && businessDaysSince(new Date(lastContact), now) < FOLLOWUP_MIN_BUSINESS_DAYS) continue;

      const { data: pauseEvent } = (await from(supabase, 'interactions')
        .select('metadata')
        .eq('lead_id', lead.id)
        .eq('channel', 'system')
        .contains('metadata', { system_event: 'cadence_paused' })
        .order('created_at', { ascending: false })
        .limit(1)) as { data: Array<{ metadata: { reason?: string } | null }> | null };

      const cadenceNames = cadencesByLead.get(lead.id) ?? [];
      const notes = buildFollowupNote(cadenceNames, pauseEvent?.[0]?.metadata?.reason);

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
        metadata: { cadences: cadenceNames, assigned_to: lead.assigned_to },
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
