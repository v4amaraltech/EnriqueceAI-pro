import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import type { DashboardFilters, MeetingDayLead, UpcomingMeetingsData } from '../types';
import { addDays, brtDateOf, brtDayStartIso, UPCOMING_WINDOW_DAYS, windowDates } from '../utils/upcoming-days';

/**
 * Bloco "Reuniões futuras" do dashboard: leads cuja reunião COMEÇA
 * (`meeting_starts_at`, não a data em que foi marcada) em cada dia BRT da janela.
 *
 * Mesma base de `fetchScheduledLeadsForRanking` — org, não apagado, SDR ativo ou
 * convidado, filtro de vendedor — mais: fora `archived` e `unqualified` (Perdido),
 * porque reunião de lead perdido já caiu. Não usa o filtro de mês: a janela
 * vem do próprio bloco (olha pra frente a partir de hoje).
 */
export async function fetchUpcomingMeetings(
  supabase: SupabaseClient,
  orgId: string,
  filters: Pick<DashboardFilters, 'userIds'>,
  startDate: string,
  days: number = UPCOMING_WINDOW_DAYS,
): Promise<UpcomingMeetingsData> {
  const dates = windowDates(startDate, days);
  const start = brtDayStartIso(startDate);
  const end = brtDayStartIso(addDays(startDate, days));

  const [{ data: sdrs }, { data: rows }] = await Promise.all([
    from(supabase, 'organization_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('role', 'sdr')
      .in('status', ['active', 'invited']) as unknown as Promise<{ data: Array<{ user_id: string }> | null }>,
    from(supabase, 'leads')
      .select('id, razao_social, nome_fantasia, assigned_to, meeting_scheduled_at, meeting_starts_at')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .not('status', 'in', '(archived,unqualified)')
      .gte('meeting_starts_at', start)
      .lt('meeting_starts_at', end)
      .order('meeting_starts_at', { ascending: true })
      .limit(5000) as unknown as Promise<{
      data: Array<{
        id: string;
        razao_social: string | null;
        nome_fantasia: string | null;
        assigned_to: string | null;
        meeting_scheduled_at: string | null;
        meeting_starts_at: string;
      }> | null;
    }>,
  ]);

  const sdrIds = new Set((sdrs ?? []).map((s) => s.user_id));
  const byDate = new Map<string, MeetingDayLead[]>(dates.map((d) => [d, []]));

  for (const lead of rows ?? []) {
    const sdr = lead.assigned_to;
    if (!sdr || !sdrIds.has(sdr)) continue;
    if (filters.userIds.length > 0 && !filters.userIds.includes(sdr)) continue;
    byDate.get(brtDateOf(lead.meeting_starts_at))?.push({
      leadId: lead.id,
      razaoSocial: lead.razao_social ?? null,
      nomeFantasia: lead.nome_fantasia ?? null,
      sdrId: sdr,
      at: lead.meeting_scheduled_at ?? lead.meeting_starts_at,
      meetingAt: lead.meeting_starts_at,
    });
  }

  for (const leads of byDate.values()) {
    leads.sort((a, b) => (a.meetingAt ?? a.at).localeCompare(b.meetingAt ?? b.at));
  }

  return { days: dates.map((date) => ({ date, leads: byDate.get(date) ?? [] })) };
}
