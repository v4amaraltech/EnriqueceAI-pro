import type { SupabaseClient } from '@supabase/supabase-js';

import { chunkedIn } from '@/lib/supabase/chunked-in';
import { from } from '@/lib/supabase/from';

import { expectedByBusinessDay, seriesTargetForDay } from '../utils/pacing';
import { currentDayOfMonthBrt } from '../utils/brt-now';
import { meetingHeldAnchor, meetingsHeldWindowFilter } from '../utils/meetings-held-window';
import { fetchSaoByLead } from './sao-feedback.service';
import type {
  CadenceOption,
  DailyDataPoint,
  DashboardFilters,
  OpportunityKpiData,
  SaoKpiData,
} from '../types';

function getMonthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(year, mon, 0).getDate();
  // Janela de CONTAGEM = mês inteiro → o total e a série contam até HOJE. As datas
  // de evento contadas nunca são futuras: meeting_scheduled_at é sempre <= agora, e
  // as reuniões realizadas têm teto explícito em "agora" (meetingsHeldWindowFilter —
  // um ganho adiantado carimba antes do evento). Assim "mês inteiro" == "até hoje" e
  // o número grande e o último ponto do gráfico batem entre si e com o Sales Hub
  // (que também conta até hoje).
  // ⚠️ NÃO recuar esta janela para "ontem": o PACING ("esperado até…"/%) é que usa a
  // régua do dia fechado (`currentDayOfMonthBrt` = ontem) — contagem e pacing são
  // réguas DIFERENTES de propósito, espelhando o Sales Hub (nº hoje × meta ontem).
  return {
    start: `${year}-${String(mon).padStart(2, '0')}-01T03:00:00Z`,
    end: `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59-03:00`,
  };
}

/** Use dateFrom/dateTo when available, fallback to month range */
function getDateRange(filters: DashboardFilters): { start: string; end: string } {
  if (filters.dateFrom && filters.dateTo) {
    return {
      start: `${filters.dateFrom}T03:00:00Z`,
      end: `${filters.dateTo}T23:59:59-03:00`,
    };
  }
  return getMonthRange(filters.month);
}

function getDaysInMonth(month: string): number {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return new Date(year, mon, 0).getDate();
}

function computeDailyData(
  leadDates: string[],
  month: string,
  target: number,
  maxDayOverride?: number,
): DailyDataPoint[] {
  const days = getDaysInMonth(month);
  const [year, mon] = month.split('-').map(Number) as [number, number];
  // Série vai até HOJE (dia corrente no mês) — mesma régua da janela de contagem,
  // pra que o último ponto do gráfico = número grande do card. Dias futuros ficam
  // null. (O pacing/"esperado" usa régua separada — o dia fechado de ontem.)
  // `maxDayOverride` fecha a série no fim de um range customizado (dateFrom/dateTo)
  // dentro do mês, para o gráfico não estender além da janela contada no card.
  const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const isCurrentMonth =
    nowBrt.getUTCFullYear() === year && nowBrt.getUTCMonth() + 1 === mon;
  const maxDay = maxDayOverride ?? (isCurrentMonth ? nowBrt.getUTCDate() : days);

  const countByDay = new Map<number, number>();
  for (const dateStr of leadDates) {
    const brt = new Date(new Date(dateStr).getTime() - 3 * 60 * 60 * 1000);
    const day = brt.getUTCDate();
    countByDay.set(day, (countByDay.get(day) ?? 0) + 1);
  }

  const result: DailyDataPoint[] = [];
  let cumulative = 0;

  for (let day = 1; day <= days; day++) {
    cumulative += countByDay.get(day) ?? 0;
    result.push({
      date: `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day,
      actual: day <= maxDay ? cumulative : null,
      // Meta do ponto: no dia de hoje usa a régua do dia fechado (ontem), igual ao
      // "esperado até hoje" do card — o tooltip de hoje mostra a mesma meta.
      target: seriesTargetForDay(target, year, mon, day, month),
    });
  }

  return result;
}

export interface HeldLead {
  id: string;
  meeting_starts_at: string | null;
  meeting_held_at: string;
  assigned_to: string | null;
}

/**
 * Universo de "reuniões realizadas" do Dashboard na janela do filtro, já com
 * os filtros de cadência e de vendedor aplicados. Fonte ÚNICA para o KPI de
 * realizadas e para o KPI de SAO (que é um subconjunto deste) — a página cria
 * a promise uma vez e passa aos dois, evitando repetir a query.
 */
export async function fetchHeldLeadsForKpi(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<HeldLead[]> {
  const { start, end } = getDateRange(filters);

  // Reunião realizada = a reunião ACONTECEU, contada no mês em que ela ocorreu.
  // Âncora = `meeting_starts_at` (horário do evento), com fallback no carimbo
  // quando não há evento registrado; `meeting_held_at` é a PROVA de que
  // aconteceu — sem ele é reunião marcada, não realizada. Regra completa (e o
  // porquê do teto em "agora") em meetingsHeldWindowFilter — o ranking usa a
  // MESMA função.
  // (Até 09/set/2026 esta query contava por `won_at` + status='won', ou seja,
  // pelo CARIMBO do ganho. Um ganho dado no dia seguinte jogava a reunião pro
  // mês errado — 2 casos em set/2026 — e era a causa do painel mostrar 17
  // enquanto o Sales Hub, já ancorado no evento, mostrava 15.)
  //
  // Sem filtro de status de propósito: reunião que aconteceu e depois teve o
  // lead desqualificado continua sendo produção do SDR. Filtrar por 'won' aqui
  // subnotificava o time.
  let leadsQuery = from(supabase, 'leads')
    .select('id, meeting_starts_at, meeting_held_at, assigned_to')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .not('meeting_held_at', 'is', null)
    .or(meetingsHeldWindowFilter(start, end, new Date().toISOString()))
    .limit(10000);

  const { data: leads } = (await leadsQuery) as { data: HeldLead[] | null };

  let qualifiedLeads = leads ?? [];

  // Filter by cadence if active
  if (filters.cadenceIds.length > 0) {
    const leadIds = qualifiedLeads.map((l) => l.id);
    if (leadIds.length > 0) {
      const enrollments = await chunkedIn<{ lead_id: string }>(leadIds, (chunk) =>
        from(supabase, 'cadence_enrollments')
          .select('lead_id')
          .in('lead_id', chunk)
          .in('cadence_id', filters.cadenceIds) as unknown as PromiseLike<{
          data: Array<{ lead_id: string }> | null;
          error: unknown;
        }>,
      );
      const enrolledIds = new Set(enrollments.map((e) => e.lead_id));
      qualifiedLeads = qualifiedLeads.filter((l) => enrolledIds.has(l.id));
    }
  }

  // Filter by user: atribuição pelo SDR responsável do lead (assigned_to) — a
  // mesma regra do ranking "Reuniões Realizadas", do card "Reuniões marcadas",
  // do guia de cards e do Sales Hub. (Antes usava won_by ?? assigned_to, o que
  // fazia KPI e ranking divergirem sob filtro de SDR — 03/set/2026.)
  if (filters.userIds.length > 0) {
    qualifiedLeads = qualifiedLeads.filter(
      (l) => l.assigned_to !== null && filters.userIds.includes(l.assigned_to),
    );
  }

  return qualifiedLeads;
}

/**
 * Monta o KPI (número grande, % do ritmo, série diária) a partir das datas
 * dos eventos contados e da meta do mês. Compartilhado por realizadas e SAO.
 */
function buildKpiData(
  anchors: string[],
  filters: DashboardFilters,
  monthTarget: number,
  conversionTarget: number,
): OpportunityKpiData {
  const days = getDaysInMonth(filters.month);
  const totalOpportunities = anchors.length;

  // % de meta na projeção linear (BRT), paceado pelo último dia CONCLUÍDO
  // (currentDayOfMonthBrt = ontem no mês corrente) — fonte única do pace.
  const [yr, mo] = filters.month.split('-').map(Number) as [number, number];
  const currentDay = currentDayOfMonthBrt(filters.month);

  const expectedByToday = expectedByBusinessDay(monthTarget, yr, mo, currentDay);
  const percentOfTarget =
    expectedByToday > 0
      ? Math.round(
          ((totalOpportunities - expectedByToday) / expectedByToday) * 100,
        )
      : 0;

  // When a custom date range is active, the daily series must follow the SAME
  // window that produced totalOpportunities — otherwise the count (getDateRange)
  // and the chart (filters.month) diverge. Derive the series month from the
  // range start and clamp the last plotted day to the range end when it falls
  // in that month.
  const customRange = Boolean(filters.dateFrom && filters.dateTo);
  const seriesMonth = customRange ? filters.dateFrom!.slice(0, 7) : filters.month;
  let maxDayOverride: number | undefined;
  if (customRange) {
    const [fromYear, fromMon] = filters.dateFrom!.split('-').map(Number) as [number, number];
    const [toYear, toMon, toDay] = filters.dateTo!.split('-').map(Number) as [number, number, number];
    // Clamp only when the range ends in the same month it started; a multi-month
    // range is best-effort (series anchored to the start month).
    if (toYear === fromYear && toMon === fromMon) {
      maxDayOverride = toDay;
    }
  }

  const dailyData = computeDailyData(anchors, seriesMonth, monthTarget, maxDayOverride);

  return {
    totalOpportunities,
    monthTarget,
    conversionTarget,
    percentOfTarget,
    currentDay,
    daysInMonth: days,
    dailyData,
  };
}

export async function fetchOpportunityKpi(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
  held?: PromiseLike<HeldLead[]>,
): Promise<OpportunityKpiData> {
  const qualifiedLeads = await (held ?? fetchHeldLeadsForKpi(supabase, orgId, filters));

  // Query goal for the month
  const monthStart = `${filters.month}-01`;
  const { data: goal } = (await from(supabase, 'goals')
    .select('opportunity_target, meetings_held_target, conversion_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()) as {
    data: { opportunity_target: number; meetings_held_target: number | null; conversion_target: number } | null;
  };

  // meetings_held_target é o nome canônico; opportunity_target é legacy
  // mantido como fallback pra metas históricas antes da consolidação.
  const monthTarget = goal?.meetings_held_target || goal?.opportunity_target || 0;
  const conversionTarget = goal?.conversion_target ?? 0;

  return buildKpiData(qualifiedLeads.map(meetingHeldAnchor), filters, monthTarget, conversionTarget);
}

/**
 * KPI de SAO (Oportunidade Aceita por Vendas): das reuniões realizadas do mês
 * (MESMO universo, janela e filtros do card de realizadas), quantas o closer
 * aceitou como oportunidade qualificada no feedback (resposta mais recente
 * com a pergunta preenchida — ver fetchSaoByLead).
 *
 * Ancora cada SAO na data da REUNIÃO (meetingHeldAnchor), não na data da
 * resposta do closer: assim SAO ⊆ realizadas em todo ponto do gráfico e o
 * card não sofre o "carimbo × evento" que desalinhou realizadas em set/2026.
 * Reunião sem feedback (ou com feedback anterior a 09/set/2026, quando a
 * pergunta não existia) não entra — nem como SAO nem como "não qualificada".
 */
export async function fetchSaoKpi(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
  held?: PromiseLike<HeldLead[]>,
): Promise<SaoKpiData> {
  const heldLeads = await (held ?? fetchHeldLeadsForKpi(supabase, orgId, filters));
  const saoByLead = await fetchSaoByLead(
    supabase,
    orgId,
    heldLeads.map((l) => l.id),
  );

  const saoLeads = heldLeads.filter((l) => saoByLead.get(l.id) === true);
  const evaluatedTotal = heldLeads.filter((l) => saoByLead.has(l.id)).length;

  const monthStart = `${filters.month}-01`;
  const { data: goal } = (await from(supabase, 'goals')
    .select('sao_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()) as { data: { sao_target: number | null } | null };

  const kpi = buildKpiData(saoLeads.map(meetingHeldAnchor), filters, goal?.sao_target ?? 0, 0);

  return {
    ...kpi,
    heldTotal: heldLeads.length,
    evaluatedTotal,
    qualifiedTotal: saoLeads.length,
  };
}

export async function fetchAvailableCadences(
  supabase: SupabaseClient,
  orgId: string,
): Promise<CadenceOption[]> {
  const { data } = (await from(supabase, 'cadences')
    .select('id, name')
    .eq('org_id', orgId)
    .in('status', ['active', 'paused'])
    .order('name')) as {
    data: Array<{ id: string; name: string }> | null;
  };

  return data ?? [];
}
