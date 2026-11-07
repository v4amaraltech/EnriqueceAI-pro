import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { fetchHeldLeadsForKpi } from '@/features/dashboard/services/dashboard-metrics.service';
import { fetchNoShowsRanking } from '@/features/dashboard/services/ranking-metrics.service';
import { fetchSdrPaceMetrics } from '@/features/dashboard/services/sdr-pace.service';
import type { DashboardFilters } from '@/features/dashboard/types';

export interface CockpitHeldMeeting {
  leadId: string;
  company: string;
  closerName: string | null;
  meetingAt: string;
}

export interface CockpitGoalsData {
  month: string;
  /** Meta individual de reuniões realizadas (`goals_per_user`); 0 = sem meta. */
  heldTarget: number;
  held: number;
  scheduled: number;
  noShows: number;
  meetings: CockpitHeldMeeting[];
}

/**
 * Histórico de metas de UM SDR no mês. Mesmas fontes do /dashboard:
 * realizadas/agendadas de `fetchSdrPaceMetrics` (seção "SDR selecionado"),
 * no-show dos eventos da timeline (`fetchNoShowsRanking`) e a lista de
 * realizadas de `fetchHeldLeadsForKpi` (âncora na data da reunião).
 * `userId` já vem validado por `resolveCockpitViewer`.
 */
export async function fetchCockpitGoals(orgId: string, userId: string, month: string): Promise<CockpitGoalsData> {
  const supabase = createServiceRoleClient();
  const filters: DashboardFilters = { month, cadenceIds: [], userIds: [userId] };

  const [pace, noShows, heldLeads] = await Promise.all([
    fetchSdrPaceMetrics(supabase, orgId, month, userId),
    fetchNoShowsRanking(supabase, orgId, filters),
    fetchHeldLeadsForKpi(supabase, orgId, filters),
  ]);

  const ids = heldLeads.map((l) => l.id);
  const closerByLead = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data } = (await from(supabase, 'leads')
      .select('id, closer:closers(name)')
      .eq('org_id', orgId)
      .in('id', ids)) as { data: Array<{ id: string; closer: { name: string } | null }> | null };
    for (const row of data ?? []) closerByLead.set(row.id, row.closer?.name ?? null);
  }

  const meetings = heldLeads
    .map((l) => ({
      leadId: l.id,
      company: l.nome_fantasia ?? l.razao_social ?? 'Lead sem nome',
      closerName: closerByLead.get(l.id) ?? null,
      meetingAt: l.meeting_starts_at ?? l.meeting_held_at,
    }))
    .sort((a, b) => b.meetingAt.localeCompare(a.meetingAt));

  return {
    month,
    heldTarget: pace.target.meetingsHeld,
    held: pace.actual.meetingsHeld,
    scheduled: pace.actual.meetingsScheduled,
    noShows: noShows.total,
    meetings,
  };
}
