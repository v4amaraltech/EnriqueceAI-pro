import type { SupabaseClient } from '@supabase/supabase-js';

import { meetingHeldAnchor } from '../utils/meetings-held-window';
import { fetchHeldLeadsForKpi } from './dashboard-metrics.service';
import { brtDayOf, fetchScheduledLeadsForRanking } from './ranking-metrics.service';
import type { DashboardFilters, MeetingDayLead, MeetingsByDayLeads } from '../types';

/**
 * Leads por trás de uma barra do gráfico "RM e RR por dia".
 *
 * Reusa os MESMOS universos que geram os cards (e, por diferença do acumulado,
 * as barras): `fetchScheduledLeadsForRanking` (marcadas) e `fetchHeldLeadsForKpi`
 * (realizadas), com os mesmos `filters` da página. Só o corte por dia é feito
 * aqui, no calendário BRT — a mesma régua que o ranking usa para montar
 * `dailyData`. Assim a lista sempre soma o rótulo da barra.
 */
export async function fetchMeetingsByDayLeads(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
  day: number,
): Promise<MeetingsByDayLeads> {
  const [scheduledUniverse, heldUniverse] = await Promise.all([
    fetchScheduledLeadsForRanking(supabase, orgId, filters),
    fetchHeldLeadsForKpi(supabase, orgId, filters),
  ]);

  const scheduled: MeetingDayLead[] = [];
  for (const lead of scheduledUniverse.leads) {
    if (brtDayOf(lead.meeting_scheduled_at) !== day) continue;
    scheduled.push({
      leadId: lead.id,
      razaoSocial: lead.razao_social,
      nomeFantasia: lead.nome_fantasia,
      sdrId: lead.assigned_to,
      at: lead.meeting_scheduled_at,
      meetingAt: lead.meeting_starts_at,
    });
  }

  const held: MeetingDayLead[] = [];
  for (const lead of heldUniverse) {
    // Sem SDR responsável o lead não entra em nenhum ranking; a série do KPI
    // sem filtro de vendedor conta mesmo assim, então mantemos com sdrId vazio.
    const at = meetingHeldAnchor(lead);
    if (brtDayOf(at) !== day) continue;
    held.push({
      leadId: lead.id,
      razaoSocial: lead.razao_social ?? null,
      nomeFantasia: lead.nome_fantasia ?? null,
      sdrId: lead.assigned_to ?? '',
      at,
      meetingAt: at,
    });
  }

  // Ordem = coluna visível (data/hora da reunião); sem horário, cai no instante da barra.
  const byMeeting = (a: MeetingDayLead, b: MeetingDayLead) =>
    (a.meetingAt ?? a.at).localeCompare(b.meetingAt ?? b.at);
  scheduled.sort(byMeeting);
  held.sort(byMeeting);

  return { scheduled, held };
}
